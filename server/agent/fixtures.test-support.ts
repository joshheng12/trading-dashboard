import type {
  BrokerSnapshot,
  Decision,
  Evidence,
  MarketRegime,
  ResearchReport,
} from '../../src/types/research'
import { normalizeFundamentals } from '../research/fundamentals'
import { tradingConfig } from '../config/trading'
import { strategy } from './strategy'
import { rejectedRisk } from './riskManager'

export const testTime = '2026-09-23T15:00:00.000Z'
export function fixtureEvidence(): Evidence {
  return {
    symbol: 'AAPL',
    collectedAt: testTime,
    mode: 'RESEARCH_ONLY',
    eligible: true,
    errors: [],
    market: {
      symbol: 'AAPL',
      observedAt: testTime,
      priceAsOf: testTime,
      source: 'alpaca-iex',
      price: 100,
      previousClose: 99,
      open: 99,
      high: 101,
      low: 98,
      volume: 200000,
      averageVolume: 150000,
      candles: [],
      quality: { eligible: true, issues: [] },
    },
    technical: {
      symbol: 'AAPL',
      asOf: '2026-09-22T04:00:00Z',
      returns: { '1d': 0.01, '5d': 0.03, '20d': 0.1, '50d': 0.2 },
      trend: { sma20: 95, sma50: 90, sma200: 80, ema12: 96, ema26: 92 },
      momentum: { rsi14: 55, macd: 4, macdSignal: 3, macdHistogram: 1 },
      volatility: { atr14: 2, volatility20d: 0.01 },
      volume: { current: 200000, average: 150000, relativeVolume: 1.33 },
      range: { high52Week: 110, low52Week: 70, distanceFromHigh: -0.09, distanceFromLow: 0.42 },
      quality: { eligible: true, issues: [] },
    },
    fundamentals: { ...normalizeFundamentals('AAPL', {}, Date.parse(testTime)), missingFields: [] },
    companyNews: [
      {
        id: 'https://example.com/earnings',
        url: 'https://example.com/earnings',
        symbol: 'AAPL',
        scope: 'company',
        headline: 'Earnings released',
        source: 'Example',
        publishedAt: '2026-09-23T14:00:00Z',
        summary: null,
      },
    ],
    marketNews: [],
  }
}
export function fixtureReport(): ResearchReport {
  return {
    symbol: 'AAPL',
    technicalAssessment: { trend: 'bullish', momentum: 'strong', technicalScore: 100 },
    fundamentalAssessment: { quality: 'strong', valuation: 'reasonable', fundamentalScore: 95 },
    newsAssessment: {
      sentiment: 'positive',
      newsScore: 90,
      importantEvents: [
        {
          headlineId: 'https://example.com/earnings',
          interpretation: 'Earnings catalyst with uncertainty',
        },
      ],
    },
    risks: ['Future prices uncertain'],
    catalysts: ['Earnings'],
    bullCase: 'Continued growth',
    bearCase: 'Growth decelerates',
    confidence: 95,
    dataQuality: { score: 100, missingFields: [] },
  }
}
export function fixtureBroker(): BrokerSnapshot {
  return {
    timestamp: testTime,
    accountId: 'paper-test',
    equity: 10000,
    lastEquity: 10000,
    cash: 10000,
    buyingPower: 10000,
    blocked: false,
    marketOpen: true,
    nextOpen: '2026-09-24T13:30:00Z',
    nextClose: '2026-09-23T20:00:00Z',
    positions: [],
    pendingSymbols: [],
  }
}
export const fixtureRegime: MarketRegime = {
  regime: 'BULLISH',
  timestamp: testTime,
  marketScore: 85,
  reasons: ['SPY above moving averages'],
}
export function fixtureDecision(id = 'test-decision'): Decision {
  const evidence = fixtureEvidence(),
    report = fixtureReport(),
    config = tradingConfig({})
  return {
    decisionId: id,
    timestamp: testTime,
    symbol: 'AAPL',
    evidence,
    report,
    regime: fixtureRegime,
    signal: strategy(evidence, report, fixtureRegime, config, testTime),
    risk: rejectedRisk('Not yet evaluated'),
    config,
    model: 'test-model',
    promptVersion: 'research-v1',
    error: null,
  }
}
