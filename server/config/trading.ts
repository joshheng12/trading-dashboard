import { symbolValue } from '../research/validation'
import type { OperatingMode } from '../../src/types/research'

/** Development parameters, not a claim of profitable strategy settings. */
export function tradingConfig(env: NodeJS.ProcessEnv = process.env) {
  const positive = (name: string, fallback: number) => {
    const n = env[name] === undefined ? fallback : Number(env[name])
    if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${name}`)
    return n
  }
  const fraction = (name: string, fallback: number) => {
    const n = positive(name, fallback)
    if (n > 1) throw new Error(`Invalid ${name}: must be <= 1`)
    return n
  }
  const score = (name: string, fallback: number) => {
    const n = positive(name, fallback)
    if (n > 100) throw new Error(`Invalid ${name}: must be <= 100`)
    return n
  }
  const mode = env.AI_OPERATING_MODE ?? 'RESEARCH_ONLY'
  if (!['RESEARCH_ONLY', 'MANUAL_APPROVAL', 'AUTO_PAPER'].includes(mode))
    throw new Error('Invalid AI_OPERATING_MODE')
  const sizing = env.POSITION_SIZING ?? 'fixed-dollar'
  if (!['fixed-dollar', 'portfolio-percent'].includes(sizing))
    throw new Error('Invalid POSITION_SIZING')
  return {
    tradingMode: env.TRADING_MODE ?? 'paper',
    enabled: env.AI_TRADING_ENABLED === 'true',
    automaticOrders: env.AUTO_PAPER_TRADING === 'true',
    operatingMode: mode as OperatingMode,
    model: env.OPENAI_RESEARCH_MODEL ?? null,
    schedulerTickMs: positive('SCHEDULER_TICK_MS', 30_000),
    premarketMinutes: positive('PREMARKET_MINUTES', 60),
    orderMaxAgeMs: positive('ORDER_MAX_AGE_MS', 15 * 60_000),
    stockUniverse: [
      ...new Set(
        (env.STOCK_UNIVERSE ?? 'AAPL,MSFT,NVDA,AMD,AMZN,GOOGL,META,TSLA,JPM,V,SPY,QQQ')
          .split(',')
          .map(symbolValue),
      ),
    ],
    maxCandidates: Math.floor(positive('MAX_RESEARCH_CANDIDATES', 5)),
    minimumPrice: positive('MINIMUM_STOCK_PRICE', 10),
    minimumAverageVolume: positive('MINIMUM_AVERAGE_VOLUME', 100_000),
    scanIntervalMs: positive('SCAN_INTERVAL_MS', 900_000),
    maxPriceAgeMs: positive('MAX_PRICE_AGE_MS', 120_000),
    maxDailyBarAgeMs: positive('MAX_DAILY_BAR_AGE_MS', 5 * 86_400_000),
    newsMaxAgeMs: positive('NEWS_MAX_AGE_MS', 72 * 3_600_000),
    strategy: {
      weights: {
        technical: fraction('WEIGHT_TECHNICAL', 0.35),
        fundamental: fraction('WEIGHT_FUNDAMENTAL', 0.2),
        news: fraction('WEIGHT_NEWS', 0.2),
        market: fraction('WEIGHT_MARKET', 0.15),
        quality: fraction('WEIGHT_QUALITY', 0.1),
      },
      buyThreshold: score('BUY_THRESHOLD', 80),
      sellThreshold: score('SELL_THRESHOLD', 30),
      minimumConfidence: score('MINIMUM_CONFIDENCE', 75),
      highVolatility: fraction('HIGH_VOLATILITY', 0.025),
      maxPriceDrift: fraction('MAX_PRICE_DRIFT', 0.01),
      rsiMinimum: score('RSI_MINIMUM', 45),
      rsiMaximum: score('RSI_MAXIMUM', 70),
      minimumTechnicalScore: score('MINIMUM_TECHNICAL_SCORE', 70),
      minimumRelativeVolume: positive('MINIMUM_RELATIVE_VOLUME', 1),
    },
    risk: {
      maxPositionFraction: fraction('MAX_POSITION_FRACTION', 0.02),
      maxPositions: Math.floor(positive('MAX_POSITIONS', 5)),
      maxDailyLossFraction: fraction('MAX_DAILY_LOSS_FRACTION', 0.02),
      maxExposureFraction: fraction('MAX_EXPOSURE_FRACTION', 0.2),
      minimumCashFraction: fraction('MINIMUM_CASH_FRACTION', 0.5),
      maxTradesPerDay: Math.floor(positive('MAX_TRADES_PER_DAY', 3)),
      cooldownMs: positive('LOSS_COOLDOWN_MS', 86_400_000),
      minimumDataQuality: score('MINIMUM_DATA_QUALITY', 80),
      sizing: sizing as 'fixed-dollar' | 'portfolio-percent',
      fixedDollars: positive('FIXED_POSITION_DOLLARS', 250),
      portfolioFraction: fraction('POSITION_PORTFOLIO_FRACTION', 0.01),
      limitBuffer: fraction('LIMIT_PRICE_BUFFER', 0.005),
    },
  }
}

export type TradingConfig = ReturnType<typeof tradingConfig>

export function requirePaperAutomation(env: NodeJS.ProcessEnv = process.env): void {
  if (env.TRADING_MODE !== 'paper')
    throw new Error('Automated execution requires explicit TRADING_MODE=paper.')
}
