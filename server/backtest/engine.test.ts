// @vitest-environment node
import { expect, it } from 'vitest'
import { backtest, type ReplayFrame } from './engine'
import {
  fixtureEvidence,
  fixtureRegime,
  fixtureReport,
  testTime,
} from '../agent/fixtures.test-support'
import { tradingConfig } from '../config/trading'
const config = tradingConfig({})
function frame(): ReplayFrame {
  return {
    at: testTime,
    evidence: fixtureEvidence(),
    report: fixtureReport(),
    reportAvailableAt: testTime,
    regime: fixtureRegime,
    nextBar: {
      time: Date.parse(testTime) / 1000 + 60,
      open: 100,
      high: 102,
      low: 99,
      close: 101,
      volume: 10000,
    },
  }
}
it('uses the shared strategy/risk and fills only at the next bar with costs', () => {
  const result = backtest([frame()], config, 10000, 1, 0.001)
  expect(result.results[0]?.signal.signal).toBe('BUY')
  expect(result.orders[0]?.order?.filledAt).toBe('2026-09-23T15:01:00.000Z')
  expect(result.endingEquity).toBeCloseTo(9999)
})
it('rejects future reports, fundamentals and news', () => {
  const f = frame()
  f.reportAvailableAt = '2026-09-24T00:00:00Z'
  expect(() => backtest([f], config, 10000)).toThrow('Look-ahead')
  f.reportAvailableAt = testTime
  f.evidence.fundamentals!.observedAt = '2026-09-24T00:00:00Z'
  expect(() => backtest([f], config, 10000)).toThrow('Look-ahead')
})
it('rejects same-bar fills and unfinished daily data', () => {
  const f = frame()
  f.nextBar.time = Date.parse(testTime) / 1000
  expect(() => backtest([f], config, 10000)).toThrow('next-bar')
  f.nextBar.time += 60
  f.evidence.market!.candles = [{ ...f.nextBar, time: Date.parse(testTime) / 1000 - 60 }]
  expect(() => backtest([f], config, 10000)).toThrow('Unfinished/future')
})
it('does not assume a limit order fills when the next bar never reaches it', () => {
  const f = frame()
  f.nextBar = { ...f.nextBar, open: 110, low: 109, high: 112, close: 111 }
  expect(backtest([f], config, 10000).results[0]?.fillPrice).toBeNull()
})
