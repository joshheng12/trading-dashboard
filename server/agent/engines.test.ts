// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { tradingConfig } from '../config/trading'
import {
  fixtureBroker,
  fixtureEvidence,
  fixtureRegime,
  fixtureReport,
  testTime,
} from './fixtures.test-support'
import { strategy } from './strategy'
import { marketRegime } from './marketRegime'
import { assessRisk, positionBudget, type RiskInput } from './riskManager'

const c = tradingConfig({})
function input(): RiskInput {
  const evidence = fixtureEvidence(),
    report = fixtureReport()
  return {
    evidence,
    report,
    broker: fixtureBroker(),
    config: c,
    signal: strategy(evidence, report, fixtureRegime, c, testTime),
    state: {
      status: 'RUNNING',
      mode: 'MANUAL_APPROVAL',
      automaticOrders: false,
      emergencyStop: false,
      error: null,
      revision: 0,
    },
    now: Date.parse(testTime),
    tradesToday: 0,
    lastLossAt: null,
    duplicate: false,
    unresolvedOrder: false,
    agentOwnedQty: 0,
  }
}
describe('strategy and regime', () => {
  it('scores deterministically and ignores AI technical score', () => {
    const report = fixtureReport()
    report.technicalAssessment.technicalScore = 0
    const signal = strategy(fixtureEvidence(), report, fixtureRegime, c, testTime)
    expect(signal.signal).toBe('BUY')
    expect(signal.technicalScore).toBe(100)
    expect(signal.overallScore).toBeCloseTo(94.75)
  })
  it('holds rather than repeatedly entering held positions', () =>
    expect(
      strategy(fixtureEvidence(), fixtureReport(), fixtureRegime, c, testTime, true).signal,
    ).toBe('HOLD'))
  it('sells only a held position on weak evidence', () => {
    const e = fixtureEvidence()
    e.market!.price = 10
    e.technical!.momentum.rsi14 = 20
    e.technical!.momentum.macdHistogram = -1
    e.technical!.volume.relativeVolume = 0.1
    e.technical!.returns['20d'] = -0.2
    const r = fixtureReport()
    r.fundamentalAssessment.fundamentalScore = 0
    r.newsAssessment.newsScore = 0
    expect(
      strategy(e, r, { ...fixtureRegime, regime: 'BEARISH', marketScore: 0 }, c, testTime, true)
        .signal,
    ).toBe('SELL')
    expect(
      strategy(e, r, { ...fixtureRegime, regime: 'BEARISH', marketScore: 0 }, c, testTime, false)
        .signal,
    ).toBe('HOLD')
  })
  it('fails closed on AI failure, stale prices, missing data and low confidence', () => {
    expect(strategy(fixtureEvidence(), null, fixtureRegime, c, testTime).signal).toBe('NO_TRADE')
    const e = fixtureEvidence()
    e.market!.priceAsOf = '2020-01-01T00:00:00Z'
    expect(strategy(e, fixtureReport(), fixtureRegime, c, testTime).signal).toBe('NO_TRADE')
    e.eligible = false
    expect(strategy(e, fixtureReport(), fixtureRegime, c, testTime).signal).toBe('NO_TRADE')
    const r = fixtureReport()
    r.confidence = 0
    expect(strategy(fixtureEvidence(), r, fixtureRegime, c, testTime).signal).toBe('NO_TRADE')
  })
  it('uses deterministic benchmark trend and volatility', () => {
    expect(marketRegime(fixtureEvidence(), c, testTime).regime).toBe('BULLISH')
    const e = fixtureEvidence()
    e.technical!.volatility.volatility20d = 0.05
    expect(marketRegime(e, c, testTime).regime).toBe('HIGH_VOLATILITY')
    expect(marketRegime(null, c, testTime).regime).toBe('UNKNOWN')
  })
})
describe('risk limits', () => {
  it('caps maximum position size with a whole-share limit', () => {
    const r = assessRisk(input())
    expect(r.approved).toBe(true)
    expect(r.approvedDollarAmount).toBeLessThanOrEqual(200)
    expect(r.qty * r.limitPrice!).toBe(r.approvedDollarAmount)
  })
  it('supports percentage sizing and cash reserves', () => {
    const b = fixtureBroker()
    const config = tradingConfig({
      POSITION_SIZING: 'portfolio-percent',
      POSITION_PORTFOLIO_FRACTION: '0.01',
    })
    expect(positionBudget(b, config)).toBe(100)
    b.cash = 5000
    expect(positionBudget(b, config)).toBe(0)
  })
  const cases: [string, (i: RiskInput) => void][] = [
    [
      'market closed',
      (i) => {
        i.broker.marketOpen = false
      },
    ],
    [
      'live mode',
      (i) => {
        i.config = { ...c, tradingMode: 'live' }
      },
    ],
    [
      'daily loss',
      (i) => {
        i.broker.equity = 9700
      },
    ],
    [
      'duplicate order',
      (i) => {
        i.duplicate = true
      },
    ],
    [
      'unresolved order',
      (i) => {
        i.unresolvedOrder = true
      },
    ],
    [
      'broker pending order',
      (i) => {
        i.broker.pendingSymbols = ['MSFT']
      },
    ],
    [
      'maximum trades',
      (i) => {
        i.tradesToday = 3
      },
    ],
    [
      'cooldown',
      (i) => {
        i.lastLossAt = i.now - 1000
      },
    ],
    [
      'cash reserve',
      (i) => {
        i.broker.cash = 4900
      },
    ],
    [
      'buying power',
      (i) => {
        i.broker.buyingPower = 0
      },
    ],
    [
      'missing account',
      (i) => {
        i.broker.equity = NaN
      },
    ],
    [
      'restricted account',
      (i) => {
        i.broker.blocked = true
      },
    ],
    [
      'stale data',
      (i) => {
        i.evidence.market!.priceAsOf = '2020-01-01T00:00:00Z'
      },
    ],
    [
      'missing evidence',
      (i) => {
        i.evidence.eligible = false
      },
    ],
    [
      'emergency stop',
      (i) => {
        i.state.emergencyStop = true
      },
    ],
    [
      'paused',
      (i) => {
        i.state.status = 'PAUSED'
      },
    ],
    [
      'existing position',
      (i) => {
        i.broker.positions = [{ symbol: 'AAPL', qty: 1, price: 100, marketValue: 100 }]
      },
    ],
    [
      'maximum positions',
      (i) => {
        i.broker.positions = Array.from({ length: 5 }, (_, n) => ({
          symbol: `X${n}`,
          qty: 1,
          price: 100,
          marketValue: 100,
        }))
      },
    ],
    [
      'maximum exposure',
      (i) => {
        i.broker.positions = [{ symbol: 'MSFT', qty: 20, price: 100, marketValue: 2000 }]
      },
    ],
  ]
  it.each(cases)('rejects %s', (_label, change) => {
    const i = input()
    change(i)
    expect(assessRisk(i).approved).toBe(false)
  })
  it('never shorts or sells manual holdings', () => {
    const i = input()
    i.signal.signal = 'SELL'
    i.broker.positions = [{ symbol: 'AAPL', qty: 5, price: 100, marketValue: 500 }]
    expect(assessRisk(i).approved).toBe(false)
    i.agentOwnedQty = 2
    i.broker.positions[0]!.qty = 2
    expect(assessRisk(i).qty).toBe(2)
  })
})
