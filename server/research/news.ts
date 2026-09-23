import { finnhub } from '../finnhub'
import { tradingConfig } from '../config/trading'
import type { NewsItem } from '../../src/types/research'
import { record, symbolValue } from './validation'

/** Deterministic evidence selection, not sentiment inference. Old/future articles never become catalysts. */
export function analyzeNews(
  input: unknown,
  symbol: string | null,
  now: number,
  maxAgeMs: number,
): NewsItem[] {
  if (!Array.isArray(input)) throw new Error('Invalid news response.')
  const seen = new Set<string>()
  return input
    .flatMap((value): NewsItem[] => {
      const item = record(value)
      const time = typeof item.datetime === 'number' ? item.datetime * 1000 : NaN
      if (!Number.isFinite(time) || time > now || now - time > maxAgeMs) return []
      if (
        typeof item.headline !== 'string' ||
        !item.headline.trim() ||
        typeof item.source !== 'string' ||
        !item.source.trim() ||
        typeof item.url !== 'string'
      )
        return []
      let url: URL
      try {
        url = new URL(item.url)
      } catch {
        return []
      }
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return []
      seen.add(url.href)
      return [
        {
          id: url.href,
          scope: symbol ? 'company' : 'market',
          symbol,
          headline: item.headline,
          source: item.source,
          publishedAt: new Date(time).toISOString(),
          url: url.href,
          summary: typeof item.summary === 'string' && item.summary.trim() ? item.summary : null,
        },
      ]
    })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, 30)
}

export async function news(
  symbolInput: string | null,
  request = finnhub,
  now = Date.now(),
): Promise<NewsItem[]> {
  const symbol = symbolInput === null ? null : symbolValue(symbolInput)
  const age = tradingConfig().newsMaxAgeMs
  const date = (time: number) => new Date(time).toISOString().slice(0, 10)
  const payload = symbol
    ? await request<unknown>('/company-news', { symbol, from: date(now - age), to: date(now) })
    : await request<unknown>('/news', { category: 'general' })
  return analyzeNews(payload, symbol, now, age)
}
