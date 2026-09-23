import { marketData } from './marketData'
import { technicalIndicators } from './technicalIndicators'
import { fundamentals } from './fundamentals'
import { news } from './news'
import { symbolValue } from './validation'
import type { Evidence } from '../../src/types/research'

const providers = { marketData, fundamentals, news }

/** Read-only evidence boundary. No strategy, LLM, or order access. Provider failures fail closed. */
export async function collectEvidence(input: string, dependencies = providers): Promise<Evidence> {
  const symbol = symbolValue(input)
  const results = await Promise.allSettled([
    dependencies.marketData(symbol),
    dependencies.fundamentals(symbol),
    dependencies.news(symbol),
    dependencies.news(null),
  ] as const)
  const [marketResult, fundamentalsResult, companyResult, marketNewsResult] = results
  const errors = results.flatMap((result, i) =>
    result.status === 'rejected'
      ? [`${['market', 'fundamentals', 'companyNews', 'marketNews'][i]} unavailable`]
      : [],
  )
  const market = marketResult.status === 'fulfilled' ? marketResult.value : null
  const technical = market ? technicalIndicators(symbol, market.candles, market.volume) : null
  return {
    symbol,
    collectedAt: new Date().toISOString(),
    mode: 'RESEARCH_ONLY' as const,
    eligible:
      errors.length === 0 &&
      market?.quality.eligible === true &&
      technical?.quality.eligible === true,
    errors,
    market,
    technical,
    fundamentals: fundamentalsResult.status === 'fulfilled' ? fundamentalsResult.value : null,
    companyNews: companyResult.status === 'fulfilled' ? companyResult.value : null,
    marketNews: marketNewsResult.status === 'fulfilled' ? marketNewsResult.value : null,
  }
}
