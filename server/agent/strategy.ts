import type { Evidence, MarketRegime, ResearchReport, TradeSignal } from '../../src/types/research'
import type { TradingConfig } from '../config/trading'

export function evidenceQuality(e: Evidence): number {
  if (!e.eligible || !e.technical?.quality.eligible) return 0
  const missing = e.fundamentals?.missingFields.length ?? 20
  return Math.max(0, 100 - Math.min(25, missing * 2) - (e.companyNews?.length ? 0 : 10))
}

export function noTrade(symbol: string, timestamp: string, reasons: string[]): TradeSignal {
  return {
    symbol,
    timestamp,
    technicalScore: 0,
    fundamentalScore: 0,
    newsScore: 0,
    marketScore: 0,
    riskScore: 0,
    overallScore: 0,
    signal: 'NO_TRADE',
    reasons,
  }
}

/** Pure strategy: no provider/clock/order access. Used unchanged by paper and replay. */
export function strategy(
  e: Evidence,
  report: ResearchReport | null,
  regime: MarketRegime,
  config: TradingConfig,
  at: string,
  held = false,
): TradeSignal {
  const now = Date.parse(at)
  const age = now - Date.parse(e.market?.priceAsOf ?? '')
  const regimeAge = now - Date.parse(regime.timestamp)
  if (
    !report ||
    !e.eligible ||
    !e.technical ||
    !e.market?.price ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > config.maxPriceAgeMs ||
    !Number.isFinite(regimeAge) ||
    regimeAge < 0 ||
    regimeAge > config.maxPriceAgeMs ||
    regime.regime === 'UNKNOWN'
  )
    return noTrade(e.symbol, at, ['Missing, future, stale or failed research evidence'])
  const t = e.technical!
  const p = e.market!.price!
  const quality = Math.min(evidenceQuality(e), report.dataQuality.score)
  if (
    quality < config.risk.minimumDataQuality ||
    report.confidence < config.strategy.minimumConfidence
  )
    return noTrade(e.symbol, at, ['Insufficient data quality or research confidence'])
  const factors: [boolean, number, string][] = [
    [p > (t.trend.sma20 ?? Infinity), 15, 'Price above SMA20'],
    [p > (t.trend.sma50 ?? Infinity), 20, 'Price above SMA50'],
    [p > (t.trend.sma200 ?? Infinity), 20, 'Price above SMA200'],
    [(t.momentum.macdHistogram ?? -Infinity) > 0, 15, 'Positive MACD histogram'],
    [
      (t.momentum.rsi14 ?? 0) >= config.strategy.rsiMinimum &&
        (t.momentum.rsi14 ?? 100) <= config.strategy.rsiMaximum,
      10,
      `RSI within configured strategy band (${config.strategy.rsiMinimum}-${config.strategy.rsiMaximum})`,
    ],
    [
      (t.volume.relativeVolume ?? 0) >= config.strategy.minimumRelativeVolume,
      10,
      'Relative volume meets configured threshold',
    ],
    [(t.returns['20d'] ?? -1) > 0, 10, 'Positive 20-session return'],
  ]
  const technicalScore = factors.reduce((sum, [pass, weight]) => sum + (pass ? weight : 0), 0)
  const fundamentalScore =
    report.fundamentalAssessment.quality === 'unknown'
      ? 0
      : report.fundamentalAssessment.fundamentalScore
  const newsScore = e.companyNews?.length ? report.newsAssessment.newsScore : 50
  const w = config.strategy.weights
  const total = Object.values(w).reduce((sum, n) => sum + n, 0)
  const overallScore =
    (technicalScore * w.technical +
      fundamentalScore * w.fundamental +
      newsScore * w.news +
      regime.marketScore * w.market +
      quality * w.quality) /
    total
  const reasons = factors.filter(([pass]) => pass).map(([, , reason]) => reason)
  let signal: TradeSignal['signal'] = 'HOLD'
  if (held && overallScore <= config.strategy.sellThreshold) {
    signal = 'SELL'
    reasons.push('Score below exit threshold; long position only')
  } else if (
    !held &&
    overallScore >= config.strategy.buyThreshold &&
    regime.regime === 'BULLISH' &&
    technicalScore >= config.strategy.minimumTechnicalScore
  ) {
    signal = 'BUY'
    reasons.push('Entry threshold and deterministic trend gates passed')
  } else reasons.push(held ? 'Retain existing position' : 'Entry conditions not satisfied')
  return {
    symbol: e.symbol,
    timestamp: at,
    technicalScore,
    fundamentalScore,
    newsScore,
    marketScore: regime.marketScore,
    riskScore: quality,
    overallScore,
    signal,
    reasons,
  }
}
