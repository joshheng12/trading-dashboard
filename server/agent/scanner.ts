import type { MarketSnapshot } from '../../src/types/research'
import type { TradingConfig } from '../config/trading'
import { marketData } from '../research/marketData'
import { technicalIndicators } from '../research/technicalIndicators'

export interface ScanRow {
  market?: MarketSnapshot
  symbol: string
  price: number | null
  rank: number
  selected: boolean
  reasons: string[]
}

/** Bounded sequential provider traffic. No LLM calls until deterministic selection completes. */
export async function scan(
  config: TradingConfig,
  getMarket = marketData,
  shouldStop = () => false,
): Promise<ScanRow[]> {
  const rows: ScanRow[] = []
  for (const symbol of config.stockUniverse) {
    if (shouldStop()) break
    try {
      rows.push(rankCandidate(await getMarket(symbol), config))
    } catch {
      rows.push({
        symbol,
        price: null,
        rank: 0,
        selected: false,
        reasons: ['Market data unavailable'],
      })
    }
  }
  rows.sort((a, b) => b.rank - a.rank)
  let count = 0
  return rows.map((row) => ({
    ...row,
    selected: row.reasons.length === 0 && count++ < config.maxCandidates,
  }))
}

export function rankCandidate(m: MarketSnapshot, config: TradingConfig): ScanRow {
  const reasons = [...m.quality.issues]
  const t = technicalIndicators(m.symbol, m.candles, m.volume)
  if (!m.quality.eligible || !t.quality.eligible) reasons.push('Incomplete technical evidence')
  if ((m.price ?? 0) < config.minimumPrice) reasons.push('Below minimum price')
  if ((m.averageVolume ?? 0) < config.minimumAverageVolume)
    reasons.push('Insufficient IEX liquidity')
  if ((t.volatility.volatility20d ?? Infinity) > config.strategy.highVolatility)
    reasons.push('Excessive volatility')
  const rank = Math.max(
    0,
    Math.min(
      100,
      50 +
        (t.returns['20d'] ?? 0) * 100 +
        ((m.price ?? 0) > (t.trend.sma50 ?? Infinity) ? 20 : -20) +
        Math.min(20, (t.volume.relativeVolume ?? 0) * 10),
    ),
  )
  return { symbol: m.symbol, price: m.price, rank, selected: false, reasons, market: m }
}
