import type { Candle } from '../../src/types/market'
import type { TechnicalSnapshot } from '../../src/types/research'

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const last = (xs: number[]) => xs.at(-1) ?? null
const sma = (xs: number[], period: number) => (xs.length < period ? null : mean(xs.slice(-period)))

/** SMA seed followed by exponential smoothing. Output starts at period - 1. */
export function ema(xs: number[], period: number): number[] {
  if (xs.length < period) return []
  let value = mean(xs.slice(0, period))
  const result = [value]
  for (const x of xs.slice(period)) {
    value += (2 / (period + 1)) * (x - value)
    result.push(value)
  }
  return result
}

function wilder(xs: number[], period: number): number | null {
  if (xs.length < period) return null
  let value = mean(xs.slice(0, period))
  for (const x of xs.slice(period)) value = (value * (period - 1) + x) / period
  return value
}

/** Reject corrupt/order-ambiguous input instead of silently repairing a series. */
export function validateCandles(candles: Candle[]): void {
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!
    if (
      ![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
      Math.min(c.open, c.high, c.low, c.close) <= 0 ||
      c.volume < 0 ||
      c.high < Math.max(c.open, c.close, c.low) ||
      c.low > Math.min(c.open, c.close) ||
      c.time <= 0 ||
      (i > 0 && c.time <= candles[i - 1]!.time)
    ) {
      throw new Error('Invalid, duplicate, or unordered OHLCV candles.')
    }
  }
}

/** Completed daily bars only. Returns/distances are fractions; volatility is daily sample log-return SD. */
export function technicalIndicators(
  symbol: string,
  candles: Candle[],
  currentVolume: number | null = null,
): TechnicalSnapshot {
  validateCandles(candles)
  if (currentVolume !== null && (!Number.isFinite(currentVolume) || currentVolume < 0))
    throw new Error('Invalid volume.')
  const closes = candles.map((c) => c.close)
  const price = last(closes)
  const changes = closes.slice(1).map((x, i) => x - closes[i]!)
  const gain = wilder(
    changes.map((x) => Math.max(0, x)),
    14,
  )
  const loss = wilder(
    changes.map((x) => Math.max(0, -x)),
    14,
  )
  const rsi =
    gain === null || loss === null
      ? null
      : loss === 0
        ? gain === 0
          ? 50
          : 100
        : 100 - 100 / (1 + gain / loss)
  const fast = ema(closes, 12)
  const slow = ema(closes, 26)
  const macds = slow.map((x, i) => fast[i + 14]! - x)
  const macd = last(macds)
  const signal = last(ema(macds, 9))
  const trs = candles
    .slice(1)
    .map((c, i) =>
      Math.max(c.high - c.low, Math.abs(c.high - closes[i]!), Math.abs(c.low - closes[i]!)),
    )
  const logReturns = closes
    .slice(1)
    .map((x, i) => Math.log(x / closes[i]!))
    .slice(-20)
  const avg = logReturns.length ? mean(logReturns) : 0
  const averageVolume = sma(
    candles.map((c) => c.volume),
    20,
  )
  const year = candles.slice(-252)
  const high = year.length === 252 ? Math.max(...year.map((c) => c.high)) : null
  const low = year.length === 252 ? Math.min(...year.map((c) => c.low)) : null
  const returns = (n: number) =>
    price !== null && closes.length > n ? price / closes[closes.length - n - 1]! - 1 : null
  const issues =
    candles.length < 252
      ? ['At least 252 completed daily bars required for the full snapshot.']
      : []
  return {
    symbol,
    asOf: candles.length ? new Date(candles.at(-1)!.time * 1000).toISOString() : null,
    returns: { '1d': returns(1), '5d': returns(5), '20d': returns(20), '50d': returns(50) },
    trend: {
      sma20: sma(closes, 20),
      sma50: sma(closes, 50),
      sma200: sma(closes, 200),
      ema12: last(fast),
      ema26: last(slow),
    },
    momentum: {
      rsi14: rsi,
      macd,
      macdSignal: signal,
      macdHistogram: macd === null || signal === null ? null : macd - signal,
    },
    volatility: {
      atr14: wilder(trs, 14),
      volatility20d:
        logReturns.length < 20
          ? null
          : Math.sqrt(logReturns.reduce((sum, x) => sum + (x - avg) ** 2, 0) / 19),
    },
    volume: {
      current: currentVolume,
      average: averageVolume,
      relativeVolume:
        currentVolume !== null && averageVolume !== null && averageVolume > 0
          ? currentVolume / averageVolume
          : null,
    },
    range: {
      high52Week: high,
      low52Week: low,
      distanceFromHigh: high !== null && price !== null ? price / high - 1 : null,
      distanceFromLow: low !== null && price !== null ? price / low - 1 : null,
    },
    quality: { eligible: issues.length === 0, issues },
  }
}
