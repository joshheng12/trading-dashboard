import type {
  AgentState,
  BrokerSnapshot,
  Evidence,
  ResearchReport,
  RiskDecision,
  TradeSignal,
} from '../../src/types/research'
import type { TradingConfig } from '../config/trading'
import { evidenceQuality } from './strategy'

export const rejectedRisk = (...reasons: string[]): RiskDecision => ({
  approved: false,
  reasons,
  approvedDollarAmount: 0,
  qty: 0,
  limitPrice: null,
})
export interface RiskInput {
  signal: TradeSignal
  evidence: Evidence
  report: ResearchReport | null
  broker: BrokerSnapshot
  state: AgentState
  config: TradingConfig
  now: number
  tradesToday: number
  lastLossAt: number | null
  duplicate: boolean
  unresolvedOrder: boolean
  agentOwnedQty: number
}

export function positionBudget(broker: BrokerSnapshot, config: TradingConfig): number {
  const r = config.risk
  const exposure = broker.positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0)
  const requested =
    r.sizing === 'fixed-dollar' ? r.fixedDollars : broker.equity * r.portfolioFraction
  return Math.max(
    0,
    Math.min(
      requested,
      broker.equity * r.maxPositionFraction,
      broker.equity * r.maxExposureFraction - exposure,
      broker.cash - broker.equity * r.minimumCashFraction,
      broker.buyingPower,
    ),
  )
}

/** Long-only risk validation. SELL can only reduce a quantity attributed to this agent. */
export function assessRisk(input: RiskInput): RiskDecision {
  const { broker: b, config: c, signal: s, evidence: e, state, now, report } = input
  const reasons: string[] = []
  if (c.tradingMode !== 'paper') reasons.push('Paper trading is not explicitly configured')
  if (state.status !== 'RUNNING' || state.emergencyStop)
    reasons.push('Agent paused, stopped or in error')
  if (!b.marketOpen) reasons.push('Market closed')
  if (b.blocked) reasons.push('Broker account restricted')
  if (
    b.positions.some((p) => ![p.qty, p.marketValue, p.price].every(Number.isFinite) || p.price <= 0)
  )
    reasons.push('Invalid position data')
  if (!e.market?.price || !Number.isFinite(e.market.price)) reasons.push('Invalid market price')
  if (
    ![b.equity, b.lastEquity, b.cash, b.buyingPower].every(Number.isFinite) ||
    b.equity <= 0 ||
    b.lastEquity <= 0
  )
    reasons.push('Missing account data')
  for (const stamp of [b.timestamp, e.market?.priceAsOf, s.timestamp]) {
    const age = now - Date.parse(stamp ?? '')
    if (!Number.isFinite(age) || age < 0 || age > c.maxPriceAgeMs)
      reasons.push('Stale or future decision/account/price data')
  }
  if (
    !e.eligible ||
    !report ||
    Math.min(evidenceQuality(e), report.dataQuality.score) < c.risk.minimumDataQuality
  )
    reasons.push('Insufficient data quality')
  if (!report || report.confidence < c.strategy.minimumConfidence)
    reasons.push('Insufficient confidence')
  if (input.duplicate) reasons.push('Duplicate decision or unchanged signal')
  if (input.unresolvedOrder || b.pendingSymbols.length > 0)
    reasons.push('Pending or unresolved orders require reconciliation')
  if (input.tradesToday >= c.risk.maxTradesPerDay) reasons.push('Maximum trades per day reached')
  if (s.signal !== 'BUY' && s.signal !== 'SELL') reasons.push('Signal does not request execution')
  if (reasons.length) return rejectedRisk(...new Set(reasons))
  const position = b.positions.find((p) => p.symbol === s.symbol)
  if (s.signal === 'SELL') {
    if (!position || Math.abs(position.qty - input.agentOwnedQty) > 0.000001)
      return rejectedRisk(
        'Agent/account quantity mismatch; reconcile external activity before selling',
      )
    const qty = Math.floor(Math.min(position?.qty ?? 0, input.agentOwnedQty) * 1e6) / 1e6
    if (qty <= 0) return rejectedRisk('No agent-owned long position to sell')
    return {
      approved: true,
      reasons: ['Reduce agent-owned long position'],
      qty,
      approvedDollarAmount: qty * e.market!.price!,
      limitPrice: null,
    }
  }
  if (position) reasons.push('Existing position prevents repeat buying')
  if (b.positions.length >= c.risk.maxPositions) reasons.push('Maximum positions reached')
  if ((b.lastEquity - b.equity) / b.lastEquity >= c.risk.maxDailyLossFraction)
    reasons.push('Maximum daily loss reached')
  if (input.lastLossAt !== null && now - input.lastLossAt < c.risk.cooldownMs)
    reasons.push('Cooldown after a loss')
  const budget = positionBudget(b, c)
  const price = e.market?.price
  if (!price || !Number.isFinite(price) || price <= 0) reasons.push('Invalid price')
  const limitPrice = Math.ceil((price ?? 0) * (1 + c.risk.limitBuffer) * 100) / 100
  // Whole-share buy limits cap maximum spend without relying on a future market fill price.
  const qty = limitPrice > 0 ? Math.floor(budget / limitPrice) : 0
  if (qty < 1) reasons.push('Position budget/cash reserve insufficient for one share')
  if (reasons.length) return rejectedRisk(...reasons)
  return {
    approved: true,
    reasons: ['Position, exposure, cash, loss and duplicate limits passed'],
    approvedDollarAmount: qty * limitPrice,
    qty,
    limitPrice,
  }
}
