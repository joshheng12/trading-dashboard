import type { AgentState, Decision, JournalEvent, OrderIntent } from './research'

export interface AgentDashboard {
  state: AgentState
  busy: boolean
  config: {
    enabled: boolean
    automaticOrders: boolean
    tradingMode: string
    operatingMode: string
    stockUniverse: string[]
    model: string | null
  }
  decisions: Decision[]
  orders: OrderIntent[]
  scan:
    | { symbol: string; price: number | null; rank: number; selected: boolean; reasons: string[] }[]
    | null
  events: JournalEvent[]
  performance: {
    startingEquity: number | null
    currentEquity: number | null
    totalReturn: number | null
    dailyReturn: number | null
    realizedPnl: number
    unrealizedPnl: number | null
    numberOfTrades: number
    winningTrades: number
    losingTrades: number
    winRate: number | null
    averageWinner: number | null
    averageLoser: number | null
    profitFactor: number | null
    maximumDrawdown: number | null
    largestWin: number | null
    largestLoss: number | null
    botReturn: number | null
    spyReturn: number | null
    difference: number | null
    warnings: string[]
    methodology: string
  }
  dailyReview: {
    trades: import('./research').ClosedTrade[]
    bestTrade: import('./research').ClosedTrade | null
    worstTrade: import('./research').ClosedTrade | null
    date: string
    startingEquity: number | null
    endingEquity: number | null
    dailyAgentPnl: number | null
    benchmarkReturn: number | null
    rejectedTrades: number
    strategyObservations: string[]
    riskObservations: string[]
  } | null
}
