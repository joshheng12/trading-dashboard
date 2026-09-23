// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { technicalIndicators, ema } from './technicalIndicators'
import { normalizeFundamentals } from './fundamentals'
import { analyzeNews } from './news'
import { collectEvidence } from './evidence'
import { marketData } from './marketData'
import { tradingConfig, requirePaperAutomation } from '../config/trading'
import { alpacaRequest } from '../alpacaClient'
import type { Candle } from '../../src/types/market'
import { app } from '../app'

const now = Date.parse('2026-09-23T15:00:00Z')
const bars = (count = 260): Candle[] =>
  Array.from({ length: count }, (_, i) => ({
    time: now / 1000 - (count - i) * 86_400,
    open: 100 + i,
    high: 102 + i,
    low: 98 + i,
    close: 100 + i,
    volume: 1000,
  }))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('deterministic indicators', () => {
  it('calculates trend, returns, RSI, MACD, ATR and volume from a known linear series', () => {
    const t = technicalIndicators('TEST', bars(), 2000)
    expect(t.trend.sma20).toBe(349.5)
    expect(t.trend.sma50).toBe(334.5)
    expect(t.trend.sma200).toBe(259.5)
    expect(t.trend.ema12).toBeCloseTo(353.5)
    expect(t.trend.ema26).toBeCloseTo(346.5)
    expect(t.returns['5d']).toBeCloseTo(359 / 354 - 1)
    expect(t.momentum.rsi14).toBe(100)
    expect(t.momentum.macd).toBeCloseTo(7)
    expect(t.momentum.macdSignal).toBeCloseTo(7)
    expect(t.momentum.macdHistogram).toBeCloseTo(0)
    expect(t.volatility.atr14).toBe(4)
    expect(t.volume.relativeVolume).toBe(2)
    expect(t.range.high52Week).toBe(361)
    expect(t.quality.eligible).toBe(true)
  })
  it('uses SMA seeding and returns null for missing history', () => {
    expect(ema([1, 2, 3, 4], 3)).toEqual([2, 3])
    const t = technicalIndicators('TEST', [])
    expect(t.trend.sma200).toBeNull()
    expect(t.momentum.rsi14).toBeNull()
    expect(t.volatility.atr14).toBeNull()
    expect(t.quality.eligible).toBe(false)
  })
  it('handles flat prices and zero volume without division by zero', () => {
    const t = technicalIndicators(
      'TEST',
      bars().map((c) => ({ ...c, open: 100, high: 100, low: 100, close: 100, volume: 0 })),
      0,
    )
    expect(t.momentum.rsi14).toBe(50)
    expect(t.volatility.volatility20d).toBe(0)
    expect(t.volume.relativeVolume).toBeNull()
  })
  it('rejects malformed, duplicate and unordered candles', () => {
    expect(() => technicalIndicators('TEST', [bars()[0]!, bars()[0]!])).toThrow(Error)
    expect(() => technicalIndicators('TEST', bars().reverse())).toThrow(Error)
    expect(() => technicalIndicators('TEST', [{ ...bars()[0]!, close: NaN }])).toThrow(Error)
  })
})

describe('evidence validation', () => {
  it('accepts fresh evidence and excludes the current unfinished daily bar', async () => {
    const data = await marketData(
      'AAPL',
      {
        bars: async () => [
          ...bars(),
          { ...bars().at(-1)!, time: now / 1000, close: 999, high: 1000 },
        ],
        snapshots: async () => ({
          AAPL: {
            latestTrade: { p: 100, t: new Date(now - 1000).toISOString() },
            dailyBar: { t: '2026-09-23T04:00:00Z', o: 100, h: 101, l: 99, c: 100, v: 1000 },
            prevDailyBar: { t: '2026-09-22T04:00:00Z', o: 99, h: 100, l: 98, c: 99, v: 1000 },
          },
        }),
      },
      now,
    )
    expect(data.quality).toEqual({ eligible: true, issues: [] })
    expect(data.candles).toHaveLength(260)
    expect(data.candles.at(-1)?.close).toBe(359)
  })
  it.each([-180_000, 1000])('rejects stale/future source price time offset %i', async (offset) => {
    const data = await marketData(
      'AAPL',
      {
        bars: async () => bars(),
        snapshots: async () => ({
          AAPL: { latestTrade: { p: 100, t: new Date(now + offset).toISOString() } },
        }),
      },
      now,
    )
    expect(data.quality.eligible).toBe(false)
    expect(data.quality.issues).toContain('Missing, future, or stale trade timestamp')
  })
  it('requires authentication before fetching research evidence', async () => {
    vi.stubEnv('APP_PASSCODE', 'test-passcode')
    vi.stubEnv('SESSION_SECRET', 'test-session-secret')
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    const response = await app.request('/api/research/evidence/AAPL')
    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('preserves missing fundamentals as null and genuine zero as zero', () => {
    const f = normalizeFundamentals(
      'AAPL',
      { metric: { peBasicExclExtraTTM: 0, marketCapitalization: 2, roeTTM: 'bad' } },
      now,
    )
    expect(f.valuation.pe).toBe(0)
    expect(f.marketCap).toBe(2_000_000)
    expect(f.profitability.roe).toBeNull()
    expect(f.missingFields).toContain('financialHealth.freeCashFlow')
    expect(() => normalizeFundamentals('AAPL', null)).toThrow(Error)
  })
  it('filters old/future/unsafe/duplicate news and keeps market scope separate', () => {
    const item = {
      datetime: now / 1000,
      headline: 'Earnings',
      source: 'Example',
      url: 'https://example.com/news',
    }
    const input = [
      item,
      item,
      { ...item, datetime: now / 1000 + 1 },
      { ...item, datetime: 1 },
      { ...item, url: 'javascript:alert(1)' },
    ]
    expect(analyzeNews(input, 'AAPL', now, 3_600_000)).toHaveLength(1)
    expect(analyzeNews([item], null, now, 3_600_000)[0]?.scope).toBe('market')
  })
  it('rejects stale and missing prices even with enough history', async () => {
    const data = await marketData(
      'AAPL',
      {
        bars: async () => bars(),
        snapshots: async () => ({
          AAPL: {
            latestTrade: { p: 100 },
            dailyBar: { t: '2026-09-22T04:00:00Z', o: 100, h: 101, l: 99, c: 100, v: 1000 },
          },
        }),
      },
      now,
    )
    expect(data.quality.eligible).toBe(false)
    expect(data.priceAsOf).toBeNull()
    expect(data.previousClose).toBeNull()
    expect(data.quality.issues).toContain('Current session OHLCV unavailable')
  })
  it('returns ineligible evidence on provider failure without inventing empty successful news', async () => {
    const unavailable = async (): Promise<never> => {
      throw new Error('unavailable')
    }
    const result = await collectEvidence('AAPL', {
      marketData: unavailable,
      fundamentals: unavailable,
      news: unavailable,
    })
    expect(result.eligible).toBe(false)
    expect(result.errors).toHaveLength(4)
    expect(result.companyNews).toBeNull()
  })
})

describe('paper safety', () => {
  it('defaults to disabled research-only and requires explicit paper automation config', () => {
    expect(tradingConfig({})).toMatchObject({
      enabled: false,
      automaticOrders: false,
      operatingMode: 'RESEARCH_ONLY',
    })
    expect(() => requirePaperAutomation({})).toThrow(Error)
    expect(() => requirePaperAutomation({ TRADING_MODE: 'live' })).toThrow(Error)
    expect(() => requirePaperAutomation({ TRADING_MODE: 'paper' })).not.toThrow()
    expect(tradingConfig({ STOCK_UNIVERSE: 'aapl,MSFT,AAPL' }).stockUniverse).toEqual([
      'AAPL',
      'MSFT',
    ])
  })
  it('blocks live/foreign endpoints before any network request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    for (const url of [
      'https://api.alpaca.markets/v2/orders',
      'https://evil.example/v2/orders',
      'http://paper-api.alpaca.markets/v2/orders',
    ]) {
      await expect(alpacaRequest(url, { method: 'POST' })).rejects.toThrow(Error)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('maps Alpaca network failure without leaking credentials', async () => {
    vi.stubEnv('ALPACA_API_KEY_ID', 'test')
    vi.stubEnv('ALPACA_API_SECRET_KEY', 'test-secret')
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error('sensitive upstream error')),
    )
    await expect(alpacaRequest('https://paper-api.alpaca.markets/v2/account')).rejects.toThrow(
      'Upstream network error contacting Alpaca.',
    )
  })
})
