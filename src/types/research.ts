import type { Candle } from './market'

export interface DataQuality {
  eligible: boolean
  issues: string[]
}

export interface MarketSnapshot {
  symbol: string
  observedAt: string
  priceAsOf: string | null
  source: 'alpaca-iex'
  price: number | null
  previousClose: number | null
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  averageVolume: number | null
  candles: Candle[]
  quality: DataQuality
}

export interface TechnicalSnapshot {
  symbol: string
  asOf: string | null
  returns: Record<'1d' | '5d' | '20d' | '50d', number | null>
  trend: Record<'sma20' | 'sma50' | 'sma200' | 'ema12' | 'ema26', number | null>
  momentum: Record<'rsi14' | 'macd' | 'macdSignal' | 'macdHistogram', number | null>
  volatility: { atr14: number | null; volatility20d: number | null }
  volume: { current: number | null; average: number | null; relativeVolume: number | null }
  range: {
    high52Week: number | null
    low52Week: number | null
    distanceFromHigh: number | null
    distanceFromLow: number | null
  }
  quality: DataQuality
}

export interface FundamentalSnapshot {
  symbol: string
  observedAt: string
  source: 'finnhub'
  /** Basic metrics are current observations, not point-in-time historical evidence. */
  financialPeriodAsOf: null
  marketCap: number | null
  valuation: Record<'pe' | 'forwardPe' | 'pb' | 'peg', number | null>
  growth: Record<'eps' | 'epsGrowth' | 'revenue' | 'revenueGrowth', number | null>
  profitability: Record<'roe' | 'roa' | 'operatingMargin' | 'netMargin', number | null>
  financialHealth: Record<'debtToEquity' | 'currentRatio' | 'freeCashFlow', number | null>
  dividendYield: number | null
  high52Week: number | null
  low52Week: number | null
  missingFields: string[]
}

export interface NewsItem {
  id: string
  scope: 'company' | 'market'
  symbol: string | null
  headline: string
  source: string
  publishedAt: string
  url: string
  summary: string | null
}

export type OperatingMode = 'RESEARCH_ONLY' | 'MANUAL_APPROVAL' | 'AUTO_PAPER'
export type SignalKind = 'BUY' | 'HOLD' | 'SELL' | 'NO_TRADE'
export interface Evidence {
  symbol: string
  collectedAt: string
  mode: 'RESEARCH_ONLY'
  eligible: boolean
  errors: string[]
  market: MarketSnapshot | null
  technical: TechnicalSnapshot | null
  fundamentals: FundamentalSnapshot | null
  companyNews: NewsItem[] | null
  marketNews: NewsItem[] | null
}
export interface ResearchReport {
  symbol: string
  technicalAssessment: {
    trend: 'bullish' | 'neutral' | 'bearish'
    momentum: 'strong' | 'moderate' | 'weak'
    technicalScore: number
  }
  fundamentalAssessment: {
    quality: 'strong' | 'average' | 'weak' | 'unknown'
    valuation: 'cheap' | 'reasonable' | 'expensive' | 'unknown'
    fundamentalScore: number
  }
  newsAssessment: {
    sentiment: 'positive' | 'neutral' | 'negative' | 'mixed'
    newsScore: number
    importantEvents: { headlineId: string; interpretation: string }[]
  }
  risks: string[]
  catalysts: string[]
  bullCase: string
  bearCase: string
  confidence: number
  dataQuality: { score: number; missingFields: string[] }
}
export interface MarketRegime {
  regime: 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'HIGH_VOLATILITY' | 'UNKNOWN'
  timestamp: string
  marketScore: number
  reasons: string[]
}
export interface TradeSignal {
  symbol: string
  timestamp: string
  technicalScore: number
  fundamentalScore: number
  newsScore: number
  marketScore: number
  riskScore: number
  overallScore: number
  signal: SignalKind
  reasons: string[]
}
export interface RiskDecision {
  approved: boolean
  reasons: string[]
  approvedDollarAmount: number
  qty: number
  limitPrice: number | null
}
export interface AgentState {
  status: 'RUNNING' | 'PAUSED' | 'ERROR'
  mode: OperatingMode
  automaticOrders: boolean
  emergencyStop: boolean
  error: string | null
  revision: number
}
export interface Decision {
  scanId?: string
  decisionId: string
  timestamp: string
  symbol: string
  evidence: Evidence | null
  report: ResearchReport | null
  regime: MarketRegime
  signal: TradeSignal
  risk: RiskDecision
  config: unknown
  model: string | null
  promptVersion: string
  error: string | null
}
export interface JournalEvent {
  id: number
  timestamp: string
  event: string
  decisionId: string | null
  symbol: string | null
  metadata: unknown
}
export interface OrderIntent {
  decisionId: string
  clientOrderId: string
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  notional: number
  requestedPrice: number
  createdAt: string
  status: 'RESERVED' | 'UNKNOWN' | 'WORKING' | 'TERMINAL'
  order: import('./market').Order | null
}
export interface BrokerSnapshot {
  timestamp: string
  accountId: string
  equity: number
  lastEquity: number
  cash: number
  buyingPower: number
  blocked: boolean
  marketOpen: boolean
  nextOpen: string
  nextClose: string
  positions: { symbol: string; qty: number; marketValue: number; price: number }[]
  pendingSymbols: string[]
}
export interface EquitySample {
  timestamp: string
  accountId: string
  accountEquity: number
  lastEquity: number
  agentPnl: number
  unrealizedPnl: number | null
  spyPrice: number | null
}
export interface ClosedTrade {
  symbol: string
  timestamp: string
  qty: number
  entryPrice: number
  exitPrice: number
  pnl: number
}
