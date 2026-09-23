import type { Evidence, MarketRegime } from '../../src/types/research'
import type { TradingConfig } from '../config/trading'

export function marketRegime(
  evidence: Evidence | null,
  config: TradingConfig,
  at: string,
): MarketRegime {
  const price = evidence?.market?.price
  const t = evidence?.technical
  if (
    !evidence?.eligible ||
    !price ||
    !t?.trend.sma50 ||
    !t.trend.sma200 ||
    t.volatility.volatility20d === null ||
    t.returns['5d'] === null
  ) {
    return {
      regime: 'UNKNOWN',
      timestamp: at,
      marketScore: 0,
      reasons: ['Current benchmark evidence unavailable'],
    }
  }
  const above50 = price > t.trend.sma50
  const above200 = price > t.trend.sma200
  const high = t.volatility.volatility20d >= config.strategy.highVolatility
  const regime = high
    ? 'HIGH_VOLATILITY'
    : above50 && above200 && t.returns['5d'] >= 0
      ? 'BULLISH'
      : !above50 && !above200
        ? 'BEARISH'
        : 'NEUTRAL'
  return {
    regime,
    timestamp: at,
    marketScore: { BULLISH: 85, NEUTRAL: 50, BEARISH: 15, HIGH_VOLATILITY: 0 }[regime],
    reasons: [
      `SPY ${above50 ? 'above' : 'below'} SMA50`,
      `SPY ${above200 ? 'above' : 'below'} SMA200`,
      high ? 'Elevated daily volatility' : 'Normal daily volatility',
    ],
  }
}
