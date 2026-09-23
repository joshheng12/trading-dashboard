import { fetchBasicFinancials } from '../finnhub'
import { cached } from '../cache'
import type { FundamentalSnapshot } from '../../src/types/research'
import { nullableNumber, record, symbolValue } from './validation'

/** Provider metrics retain their native ratio/percentage units; USD market cap is converted from millions. */
export function normalizeFundamentals(
  symbol: string,
  input: unknown,
  now = Date.now(),
): FundamentalSnapshot {
  const body = record(input)
  const m = body.metric === undefined ? {} : record(body.metric)
  const get = (key: string) => nullableNumber(m[key])
  const cap = get('marketCapitalization')
  const result: FundamentalSnapshot = {
    symbol,
    observedAt: new Date(now).toISOString(),
    source: 'finnhub',
    financialPeriodAsOf: null,
    marketCap: cap === null ? null : cap * 1_000_000,
    valuation: {
      pe: get('peBasicExclExtraTTM'),
      forwardPe: null,
      pb: get('pbQuarterly'),
      peg: null,
    },
    growth: {
      eps: get('epsBasicExclExtraItemsTTM'),
      epsGrowth: get('epsGrowthTTMYoy'),
      revenue: null,
      revenueGrowth: get('revenueGrowthTTMYoy'),
    },
    profitability: {
      roe: get('roeTTM'),
      roa: get('roaTTM'),
      operatingMargin: get('operatingMarginTTM'),
      netMargin: get('netProfitMarginTTM'),
    },
    financialHealth: {
      debtToEquity: get('totalDebt/totalEquityQuarterly'),
      currentRatio: get('currentRatioQuarterly'),
      freeCashFlow: null,
    },
    dividendYield: get('dividendYieldIndicatedAnnual'),
    high52Week: get('52WeekHigh'),
    low52Week: get('52WeekLow'),
    missingFields: [],
  }
  for (const [key, value] of Object.entries(result)) {
    if (key === 'financialPeriodAsOf') continue
    if (value === null) result.missingFields.push(key)
    else if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [field, number] of Object.entries(value))
        if (number === null) result.missingFields.push(`${key}.${field}`)
    }
  }
  return result
}

export async function fundamentals(
  symbolInput: string,
  request = fetchBasicFinancials,
): Promise<FundamentalSnapshot> {
  const symbol = symbolValue(symbolInput)
  return cached(`research-fundamentals:${symbol}`, 3_600_000, async () =>
    normalizeFundamentals(symbol, await request(symbol)),
  )
}
