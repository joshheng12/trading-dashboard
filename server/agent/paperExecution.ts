import type { Decision, Evidence, OrderIntent, RiskDecision } from '../../src/types/research'
import type { Order } from '../../src/types/market'
import { requirePaperAutomation, type TradingConfig } from '../config/trading'
import type { Journal } from '../persistence/journal'
import { marketData } from '../research/marketData'
import { technicalIndicators } from '../research/technicalIndicators'
import { assessRisk, rejectedRisk } from './riskManager'
import { paperBroker, type PaperBroker } from './broker'
import { fillLedger, ownedQuantity, tradingDay } from './performance'
import { strategy } from './strategy'
import { randomUUID } from 'node:crypto'

const terminalStatuses = new Set(['filled', 'canceled', 'expired', 'rejected'])

function validateOrder(order: Order, intent: OrderIntent) {
  if (
    !order.id ||
    order.clientOrderId !== intent.clientOrderId ||
    order.symbol !== intent.symbol ||
    order.side !== intent.side ||
    order.qty !== intent.qty ||
    !Number.isFinite(order.filledQty) ||
    order.filledQty < 0 ||
    order.filledQty > intent.qty + 0.000001 ||
    (order.filledQty > 0 &&
      (!order.filledAvgPrice ||
        order.filledAvgPrice <= 0 ||
        !Number.isFinite(order.filledAvgPrice)))
  )
    throw new Error('Broker order does not match reserved intent')
}

export class PaperExecution {
  constructor(
    private journal: Journal,
    private config: () => TradingConfig,
    readonly broker: PaperBroker = paperBroker,
    private getMarket = marketData,
  ) {}

  async reconcile(): Promise<void> {
    for (const intent of this.journal.intents().filter((i) => i.status !== 'TERMINAL')) {
      try {
        const order = await this.broker.order(intent.clientOrderId)
        validateOrder(order, intent)
        const terminal = terminalStatuses.has(order.status)
        if (
          JSON.stringify(order) !== JSON.stringify(intent.order) ||
          intent.status === 'UNKNOWN' ||
          intent.status === 'RESERVED'
        )
          this.journal.updateIntent(intent, order, terminal ? 'TERMINAL' : 'WORKING')
        if (!terminal && Date.now() - Date.parse(intent.createdAt) > this.config().orderMaxAgeMs) {
          await this.broker.cancel(order.id)
          this.journal.event('ORDER_CANCEL_REQUESTED', intent.decisionId, intent.symbol)
        }
      } catch {
        // A lookup failure (including not-yet-visible order) is not proof of rejection. Never resubmit.
        this.journal.event('ORDER_RECONCILIATION_PENDING', intent.decisionId, intent.symbol)
      }
    }
  }

  async cancel(decisionId: string) {
    const intent = this.journal.intent(decisionId)
    if (!intent?.order) throw new Error('Order ID is not yet reconciled')
    await this.broker.cancel(intent.order.id)
    this.journal.event('ORDER_CANCEL_REQUESTED', decisionId, intent.symbol)
    await this.reconcile()
  }

  async execute(decision: Decision, manual: boolean): Promise<RiskDecision> {
    const owner = randomUUID()
    this.journal.acquireExecution(owner)
    try {
      return await this.executeLocked(decision, manual, owner)
    } finally {
      this.journal.releaseExecution(owner)
    }
  }

  private async executeLocked(
    decision: Decision,
    manual: boolean,
    lockOwner: string,
  ): Promise<RiskDecision> {
    const c = this.config()
    requirePaperAutomation()
    if (!c.enabled) throw new Error('AI_TRADING_ENABLED must be true for paper execution')
    await this.reconcile()
    const state = this.journal.state()
    if (
      state.mode === 'RESEARCH_ONLY' ||
      (manual
        ? state.mode !== 'MANUAL_APPROVAL'
        : state.mode !== 'AUTO_PAPER' ||
          c.operatingMode !== 'AUTO_PAPER' ||
          !c.automaticOrders ||
          !state.automaticOrders)
    )
      throw new Error('Execution mode does not authorize this order')
    if (
      this.journal.get<string>(`latest:${decision.symbol}`) !== decision.decisionId ||
      this.journal.intent(decision.decisionId)
    )
      return rejectedRisk('Proposal superseded or already submitted')
    if (!decision.evidence || !decision.report || !['BUY', 'SELL'].includes(decision.signal.signal))
      return rejectedRisk('No valid trade proposal')
    if (Date.now() - Date.parse(decision.timestamp) > c.maxPriceAgeMs)
      return rejectedRisk('Proposal expired; run fresh research')
    const [broker, market] = await Promise.all([
      this.broker.snapshot(),
      this.getMarket(decision.symbol),
    ])
    const originalPrice = decision.evidence.market?.price
    if (
      !originalPrice ||
      !market.price ||
      Math.abs(market.price / originalPrice - 1) > c.strategy.maxPriceDrift
    )
      return rejectedRisk('Price moved beyond proposal tolerance')
    const evidence: Evidence = {
      ...decision.evidence,
      market,
      technical: technicalIndicators(decision.symbol, market.candles, market.volume),
      eligible: decision.evidence.eligible && market.quality.eligible,
    }
    const now = Date.now()
    const intents = this.journal.intents()
    const owned = ownedQuantity(intents, decision.symbol)
    const signal = strategy(
      evidence,
      decision.report,
      decision.regime,
      c,
      new Date(now).toISOString(),
      owned > 0,
    )
    if (signal.signal !== decision.signal.signal)
      return rejectedRisk('Strategy changed during approval revalidation')
    const ledger = fillLedger(intents)
    const lastLoss = ledger.closed.filter((t) => t.pnl < 0).at(-1)
    const risk = assessRisk({
      signal,
      evidence,
      report: decision.report,
      broker,
      state,
      config: c,
      now,
      tradesToday: intents.filter(
        (i) => tradingDay(i.createdAt) === tradingDay(new Date(now).toISOString()),
      ).length,
      lastLossAt: lastLoss ? Date.parse(lastLoss.timestamp) : null,
      duplicate: this.journal.get<string>(`executed-signal:${decision.symbol}`) === signal.signal,
      unresolvedOrder: intents.some((i) => i.status !== 'TERMINAL'),
      agentOwnedQty: owned,
    })
    this.journal.event(
      risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED',
      decision.decisionId,
      decision.symbol,
      { risk, broker, evidence, signal, config: c },
    )
    if (!risk.approved) return risk
    const expectedAccount = this.journal.get<string>('account-id')
    if (expectedAccount && expectedAccount !== broker.accountId)
      throw new Error('Paper account changed; use a separate journal')
    this.journal.put('account-id', broker.accountId)
    const intent: OrderIntent = {
      decisionId: decision.decisionId,
      clientOrderId: `ai-${decision.decisionId}`,
      symbol: decision.symbol,
      side: signal.signal === 'BUY' ? 'buy' : 'sell',
      qty: risk.qty,
      notional: risk.approvedDollarAmount,
      requestedPrice: market.price,
      createdAt: new Date(now).toISOString(),
      status: 'RESERVED',
      order: null,
    }
    this.journal.reserve(
      intent,
      state.revision,
      c.risk.maxTradesPerDay,
      tradingDay(intent.createdAt),
      tradingDay,
      lockOwner,
    )
    // Synchronous checks after durable reservation and immediately before initiating the network write.
    const finalState = this.journal.state()
    requirePaperAutomation()
    if (
      finalState.revision !== state.revision ||
      finalState.emergencyStop ||
      finalState.status !== 'RUNNING'
    ) {
      this.journal.updateIntent(intent, null, 'TERMINAL')
      return rejectedRisk('Controls changed; submission stopped')
    }
    this.journal.put(`executed-signal:${decision.symbol}`, signal.signal)
    try {
      const order = await this.broker.submit(
        {
          symbol: intent.symbol,
          side: intent.side,
          qty: risk.qty,
          type: intent.side === 'buy' ? 'limit' : 'market',
          timeInForce: 'day',
          limitPrice: risk.limitPrice ?? undefined,
        },
        intent.clientOrderId,
      )
      validateOrder(order, intent)
      this.journal.updateIntent(
        intent,
        order,
        terminalStatuses.has(order.status) ? 'TERMINAL' : 'WORKING',
      )
    } catch {
      this.journal.updateIntent(intent, null, 'UNKNOWN')
      throw new Error(
        'Paper submission outcome unknown; reconciliation required, no retry will be sent',
      )
    }
    return risk
  }
}
