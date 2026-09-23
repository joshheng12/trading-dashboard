import { fetchResearchBars, fetchResearchCalendar } from '../alpaca'
import { fetchSnapshots } from '../markets'
import { tradingConfig } from '../config/trading'
import type { MarketSnapshot } from '../../src/types/research'
import { nullableNumber, record, symbolValue, timestamp } from './validation'
import { validateCandles } from './technicalIndicators'

interface MarketDependencies {
  bars: typeof fetchResearchBars
  snapshots: typeof fetchSnapshots
  calendar?: typeof fetchResearchCalendar
}
export const marketDependencies: MarketDependencies = {
  bars: fetchResearchBars,
  snapshots: fetchSnapshots,
  calendar: fetchResearchCalendar,
}

/** Live observations only; historical evaluation must supply archived point-in-time evidence. */
export async function marketData(
  symbolInput: string,
  dependencies: MarketDependencies = marketDependencies,
  now?: number,
): Promise<MarketSnapshot> {
  const symbol = symbolValue(symbolInput)
  const config = tradingConfig()
  const [allBars, snapshots] = await Promise.all([
    dependencies.bars(symbol),
    dependencies.snapshots([symbol]),
  ])
  // A valid trade may arrive while the HTTP requests are in flight.
  now ??= Date.now()
  validateCandles(allBars)
  const snapshot = record(record(snapshots)[symbol])
  const daily = snapshot.dailyBar ? record(snapshot.dailyBar) : {}
  const previous = snapshot.prevDailyBar ? record(snapshot.prevDailyBar) : {}
  const trade = snapshot.latestTrade ? record(snapshot.latestTrade) : {}
  const price = nullableNumber(trade.p)
  const priceTime = timestamp(trade.t)
  // A daily bar's timestamp denotes its start, not completion. Exclude the entire current NY date.
  const sessionDate = (time: number) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(time)
  const candles = allBars.filter((c) => sessionDate(c.time * 1000) < sessionDate(now))
  const averageVolume =
    candles.length >= 20 ? candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20 : null
  const result: MarketSnapshot = {
    symbol,
    observedAt: new Date(now).toISOString(),
    priceAsOf: priceTime === null ? null : new Date(priceTime).toISOString(),
    source: 'alpaca-iex',
    price,
    previousClose: nullableNumber(previous.c),
    open: nullableNumber(daily.o),
    high: nullableNumber(daily.h),
    low: nullableNumber(daily.l),
    volume: nullableNumber(daily.v),
    averageVolume,
    candles,
    quality: { eligible: false, issues: [] },
  }
  const issues = result.quality.issues
  if (dependencies.calendar) {
    const expected = (await dependencies.calendar())
      .filter((date) => date < sessionDate(now))
      .slice(-252)
    const received = new Set(candles.map((c) => sessionDate(c.time * 1000)))
    if (expected.length < 252 || expected.some((date) => !received.has(date)))
      issues.push('Missing required exchange sessions in daily history')
  }
  for (const field of ['price', 'previousClose', 'open', 'high', 'low', 'averageVolume'] as const) {
    if (result[field] === null || result[field]! <= 0) issues.push(`Missing/invalid ${field}`)
  }
  if (result.volume === null || result.volume < 0) issues.push('Missing/invalid volume')
  if (priceTime === null || priceTime > now || now - priceTime > config.maxPriceAgeMs)
    issues.push('Missing, future, or stale trade timestamp')
  const dailyTime = timestamp(daily.t)
  const previousTime = timestamp(previous.t)
  if (previousTime === null || previousTime >= now || now - previousTime > config.maxDailyBarAgeMs)
    issues.push('Missing or stale previous close')
  if (dailyTime === null || dailyTime > now || sessionDate(dailyTime) !== sessionDate(now))
    issues.push('Current session OHLCV unavailable')
  const latest = candles.at(-1)
  if (!latest || now - latest.time * 1000 > config.maxDailyBarAgeMs)
    issues.push('Missing or stale daily history')
  if (candles.length < 252) issues.push('Insufficient completed daily history')
  if (
    result.high !== null &&
    result.low !== null &&
    (result.high < result.low ||
      (result.open !== null && (result.open > result.high || result.open < result.low)))
  )
    issues.push('Invalid daily OHLC range')
  result.quality.eligible = issues.length === 0
  return result
}
