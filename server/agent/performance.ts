import type {
  BrokerSnapshot,
  ClosedTrade,
  EquitySample,
  OrderIntent,
} from '../../src/types/research'

export function tradingDay(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp))
}

/** Rebuild FIFO lots from cumulative broker fills; each order is counted exactly once. */
export function fillLedger(intents: OrderIntent[]) {
  const lots = new Map<string, { qty: number; price: number }[]>()
  const closed: ClosedTrade[] = []
  const sorted = intents
    .filter((i) => (i.order?.filledQty ?? 0) > 0)
    .sort((a, b) =>
      (a.order?.filledAt ?? a.createdAt).localeCompare(b.order?.filledAt ?? b.createdAt),
    )
  for (const intent of sorted) {
    const order = intent.order!
    if (!order.filledAvgPrice || !Number.isFinite(order.filledQty) || order.filledQty < 0)
      throw new Error('Invalid fill accounting')
    const bucket = lots.get(intent.symbol) ?? []
    lots.set(intent.symbol, bucket)
    if (intent.side === 'buy') bucket.push({ qty: order.filledQty, price: order.filledAvgPrice })
    else {
      let remaining = order.filledQty
      for (const lot of bucket) {
        const qty = Math.min(remaining, lot.qty)
        if (qty <= 0) continue
        closed.push({
          symbol: intent.symbol,
          timestamp: order.filledAt ?? intent.createdAt,
          qty,
          entryPrice: lot.price,
          exitPrice: order.filledAvgPrice,
          pnl: qty * (order.filledAvgPrice - lot.price),
        })
        lot.qty -= qty
        remaining -= qty
      }
      if (remaining > 0.000001) throw new Error('Sell fills exceed agent-owned shares')
    }
  }
  return {
    lots,
    closed,
    realized: closed.reduce((sum, trade) => sum + trade.pnl, 0),
    tradeCount: sorted.length,
  }
}

export function ownedQuantity(intents: OrderIntent[], symbol: string): number {
  return (fillLedger(intents).lots.get(symbol) ?? []).reduce((sum, lot) => sum + lot.qty, 0)
}

export function performance(
  intents: OrderIntent[],
  samples: EquitySample[],
  broker: BrokerSnapshot | null,
) {
  const ledger = fillLedger(intents)
  let unrealized: number | null = 0
  const warnings: string[] = []
  for (const [symbol, lots] of ledger.lots) {
    const qty = lots.reduce((sum, lot) => sum + lot.qty, 0)
    if (qty <= 0) continue
    const position = broker?.positions.find((p) => p.symbol === symbol)
    if (!position || Math.abs(position.qty - qty) > 0.000001) {
      unrealized = null
      warnings.push(`${symbol}: account/agent quantity mismatch; reconcile external activity`)
      continue
    }
    if (unrealized !== null)
      unrealized += lots.reduce((sum, lot) => sum + lot.qty * (position.price - lot.price), 0)
  }
  const start = samples[0]
  const latest = samples.at(-1)
  const startingEquity = start?.accountEquity ?? broker?.equity ?? null
  const currentEquity = broker?.equity ?? latest?.accountEquity ?? null
  const pnl = unrealized === null ? null : ledger.realized + unrealized
  const botReturn = startingEquity && pnl !== null ? pnl / startingEquity : null
  const spyReturn =
    start?.spyPrice && latest?.spyPrice ? latest.spyPrice / start.spyPrice - 1 : null
  // Closed FIFO lot segments are aggregated per exit order timestamp and symbol.
  const groups = new Map<string, number>()
  for (const trade of ledger.closed) {
    const key = `${trade.timestamp}:${trade.symbol}`
    groups.set(key, (groups.get(key) ?? 0) + trade.pnl)
  }
  const outcomes = [...groups.values()]
  const wins = outcomes.filter((n) => n > 0),
    losses = outcomes.filter((n) => n < 0)
  const total = (xs: number[]) => xs.reduce((sum, n) => sum + n, 0)
  let peak = startingEquity ?? 0,
    drawdown = 0
  for (const point of samples) {
    const equity = (startingEquity ?? 0) + point.agentPnl
    peak = Math.max(peak, equity)
    if (peak > 0) drawdown = Math.max(drawdown, (peak - equity) / peak)
  }
  const today = broker ? tradingDay(broker.timestamp) : latest ? tradingDay(latest.timestamp) : null
  const previous = samples.filter((s) => tradingDay(s.timestamp) !== today).at(-1) ?? start
  return {
    startingEquity,
    currentEquity,
    totalReturn: botReturn,
    dailyReturn:
      startingEquity && pnl !== null ? (pnl - (previous?.agentPnl ?? 0)) / startingEquity : null,
    realizedPnl: ledger.realized,
    unrealizedPnl: unrealized,
    numberOfTrades: ledger.tradeCount,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: outcomes.length ? wins.length / outcomes.length : null,
    averageWinner: wins.length ? total(wins) / wins.length : null,
    averageLoser: losses.length ? total(losses) / losses.length : null,
    profitFactor: losses.length ? total(wins) / Math.abs(total(losses)) : null,
    maximumDrawdown: samples.length ? drawdown : null,
    largestWin: wins.length ? Math.max(...wins) : null,
    largestLoss: losses.length ? Math.min(...losses) : null,
    botReturn,
    spyReturn,
    difference: botReturn !== null && spyReturn !== null ? botReturn - spyReturn : null,
    closedTrades: ledger.closed,
    warnings,
    methodology:
      'Agent fill P/L divided by initial account equity; excludes manual trades and account transfers. SPY is price return at matching observation times. Drawdown is sampled, not intraday-exact. Short histories do not establish outperformance.',
  }
}
