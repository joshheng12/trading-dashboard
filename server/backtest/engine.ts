import type { Candle, Order } from '../../src/types/market'
import type {
  BrokerSnapshot,
  Evidence,
  MarketRegime,
  OrderIntent,
  ResearchReport,
} from '../../src/types/research'
import type { TradingConfig } from '../config/trading'
import { strategy } from '../agent/strategy'
import { assessRisk } from '../agent/riskManager'
import { fillLedger, ownedQuantity, tradingDay } from '../agent/performance'
import { parseResearch } from '../research/researchSchema'

export interface ReplayFrame {
  at: string
  evidence: Evidence
  report: ResearchReport | null
  reportAvailableAt: string
  regime: MarketRegime
  /** Execution-only bar, never passed into strategy or risk. Must begin strictly after evaluation. */
  nextBar: Candle
}

function assertAvailable(frame: ReplayFrame) {
  if (frame.report) parseResearch(frame.report, frame.evidence)
  const at = Date.parse(frame.at)
  const evidence = frame.evidence
  const dates = [
    evidence.collectedAt,
    evidence.market?.observedAt,
    evidence.market?.priceAsOf,
    evidence.technical?.asOf,
    evidence.fundamentals?.observedAt,
    frame.reportAvailableAt,
    frame.regime.timestamp,
    ...(evidence.companyNews ?? []).map((n) => n.publishedAt),
    ...(evidence.marketNews ?? []).map((n) => n.publishedAt),
  ]
  if (
    !Number.isFinite(at) ||
    dates.some(
      (date) => date != null && (!Number.isFinite(Date.parse(date)) || Date.parse(date) > at),
    )
  )
    throw new Error('Look-ahead evidence rejected')
  if (
    evidence.market?.candles.some(
      (c) => tradingDay(new Date(c.time * 1000).toISOString()) >= tradingDay(frame.at),
    )
  )
    throw new Error('Unfinished/future daily candle rejected')
  if (
    frame.nextBar.time * 1000 <= at ||
    ![
      frame.nextBar.time,
      frame.nextBar.open,
      frame.nextBar.high,
      frame.nextBar.low,
      frame.nextBar.close,
    ].every(Number.isFinite) ||
    frame.nextBar.low <= 0 ||
    frame.nextBar.high < Math.max(frame.nextBar.open, frame.nextBar.close) ||
    frame.nextBar.low > Math.min(frame.nextBar.open, frame.nextBar.close)
  )
    throw new Error('Invalid next-bar execution data')
}

/** Point-in-time replay only. Does not fetch providers or regenerate past reports using today's model. */
export function backtest(
  frames: ReplayFrame[],
  config: TradingConfig,
  startingEquity: number,
  feeDollars = 0,
  slippageFraction = 0.001,
) {
  if (
    !Number.isFinite(startingEquity) ||
    startingEquity <= 0 ||
    !Number.isFinite(feeDollars) ||
    feeDollars < 0 ||
    !Number.isFinite(slippageFraction) ||
    slippageFraction < 0 ||
    slippageFraction > 0.1
  )
    throw new Error('Invalid backtest settings')
  frames.forEach(assertAvailable)
  for (let i = 1; i < frames.length; i++)
    if (Date.parse(frames[i]!.at) < Date.parse(frames[i - 1]!.at))
      throw new Error('Replay frames must be chronological')
  let cash = startingEquity
  let dailyEquity = startingEquity
  let day = ''
  let lastSignal: Record<string, string> = {}
  const prices = new Map<string, number>()
  const intents: OrderIntent[] = []
  const results: {
    at: string
    signal: ReturnType<typeof strategy>
    risk: ReturnType<typeof assessRisk>
    fillPrice: number | null
  }[] = []
  const pending: {
    due: number
    frame: ReplayFrame
    result: (typeof results)[number]
    intent: OrderIntent
  }[] = []
  const flush = (until: number) => {
    pending.sort((a, b) => a.due - b.due)
    while (pending.length && pending[0]!.due <= until) {
      const item = pending.shift()!
      const { intent, frame, result } = item
      const bar = frame.nextBar
      const limit = result.risk.limitPrice
      const executionPrice =
        intent.side === 'buy'
          ? limit !== null && bar.open <= limit
            ? Math.min(limit, bar.open * (1 + slippageFraction))
            : null
          : bar.open * (1 - slippageFraction)
      if (
        executionPrice === null ||
        (intent.side === 'buy' && executionPrice * intent.qty + feeDollars > cash)
      ) {
        intent.status = 'TERMINAL'
        result.fillPrice = null
        continue
      }
      cash += (intent.side === 'buy' ? -1 : 1) * intent.qty * executionPrice - feeDollars
      prices.set(intent.symbol, executionPrice)
      const fillAt = new Date(item.due).toISOString()
      const order: Order = {
        id: intent.clientOrderId,
        clientOrderId: intent.clientOrderId,
        symbol: intent.symbol,
        side: intent.side,
        type: intent.side === 'buy' ? 'limit' : 'market',
        timeInForce: 'day',
        status: 'filled',
        qty: intent.qty,
        filledQty: intent.qty,
        filledAvgPrice: executionPrice,
        submittedAt: intent.createdAt,
        filledAt: fillAt,
      }
      intent.order = order
      intent.status = 'TERMINAL'
      result.fillPrice = executionPrice
    }
  }
  for (const [index, frame] of frames.entries()) {
    const now = Date.parse(frame.at)
    flush(now)
    const symbol = frame.evidence.symbol
    if (frame.evidence.market?.price) prices.set(symbol, frame.evidence.market.price)
    const positions = [...fillLedger(intents).lots.entries()]
      .map(([ticker, lots]) => {
        const qty = lots.reduce((sum, lot) => sum + lot.qty, 0)
        const price = prices.get(ticker) ?? 0
        return { symbol: ticker, qty, price, marketValue: qty * price }
      })
      .filter((p) => p.qty > 0)
    const equity = cash + positions.reduce((sum, p) => sum + p.marketValue, 0)
    if (day !== tradingDay(frame.at)) {
      day = tradingDay(frame.at)
      dailyEquity = equity
    }
    const owned = ownedQuantity(intents, symbol)
    const signal = strategy(frame.evidence, frame.report, frame.regime, config, frame.at, owned > 0)
    if (signal.signal === 'HOLD') lastSignal = { ...lastSignal, [symbol]: '' }
    const broker: BrokerSnapshot = {
      timestamp: frame.at,
      accountId: 'backtest',
      equity,
      lastEquity: dailyEquity,
      cash,
      buyingPower: cash,
      blocked: false,
      marketOpen: true,
      nextOpen: frame.at,
      nextClose: frame.at,
      positions,
      pendingSymbols: pending.map((p) => p.intent.symbol),
    }
    const loss = fillLedger(intents)
      .closed.filter((t) => t.pnl < 0)
      .at(-1)
    const risk = assessRisk({
      signal,
      evidence: frame.evidence,
      report: frame.report,
      broker,
      state: {
        status: 'RUNNING',
        mode: 'AUTO_PAPER',
        emergencyStop: false,
        automaticOrders: true,
        error: null,
        revision: 0,
      },
      config,
      now,
      tradesToday: intents.filter((i) => tradingDay(i.createdAt) === day).length,
      lastLossAt: loss ? Date.parse(loss.timestamp) : null,
      duplicate: lastSignal[symbol] === signal.signal,
      unresolvedOrder: pending.length > 0,
      agentOwnedQty: owned,
    })
    const result = { at: frame.at, signal, risk, fillPrice: null as number | null }
    results.push(result)
    if (risk.approved) {
      const intent: OrderIntent = {
        decisionId: `replay-${index}`,
        clientOrderId: `replay-${index}`,
        symbol,
        side: signal.signal === 'BUY' ? 'buy' : 'sell',
        qty: risk.qty,
        notional: risk.approvedDollarAmount,
        requestedPrice: frame.evidence.market!.price!,
        createdAt: frame.at,
        status: 'RESERVED',
        order: null,
      }
      intents.push(intent)
      lastSignal[symbol] = signal.signal
      pending.push({ due: frame.nextBar.time * 1000, frame, result, intent })
    }
  }
  flush(Infinity)
  const holdings = [...fillLedger(intents).lots.entries()].reduce(
    (sum, [symbol, lots]) =>
      sum + lots.reduce((n, lot) => n + lot.qty * (prices.get(symbol) ?? 0), 0),
    0,
  )
  return {
    startingEquity,
    endingEquity: cash + holdings,
    totalReturn: (cash + holdings) / startingEquity - 1,
    feeDollars,
    slippageFraction,
    results,
    orders: intents,
    limitations: [
      'Requires genuinely archived available-at evidence; timestamps cannot establish that imported data is authentic.',
      'Conservative next-open-only fills omit intrabar limit touches, queue position, partial fills, liquidity and corporate actions. Final holdings use last observed marks.',
      'Historical AI reports must be archived; no present-day fundamentals or regenerated reports are fetched.',
    ],
  }
}
