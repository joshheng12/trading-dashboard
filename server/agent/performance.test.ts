// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { EquitySample, OrderIntent } from '../../src/types/research'
import { fillLedger, performance } from './performance'
import { fixtureBroker, testTime } from './fixtures.test-support'

function intent(
  id: string,
  side: 'buy' | 'sell',
  qty: number,
  price: number,
  minute: number,
): OrderIntent {
  const timestamp = new Date(Date.parse(testTime) + minute * 60000).toISOString()
  return {
    decisionId: id,
    clientOrderId: id,
    symbol: 'AAPL',
    side,
    qty,
    notional: qty * price,
    requestedPrice: price,
    createdAt: timestamp,
    status: 'TERMINAL',
    order: {
      id,
      clientOrderId: id,
      symbol: 'AAPL',
      side,
      qty,
      filledQty: qty,
      filledAvgPrice: price,
      status: 'filled',
      submittedAt: timestamp,
      filledAt: timestamp,
      type: 'market',
      timeInForce: 'day',
    },
  }
}
describe('fill accounting and analytics', () => {
  it('accounts partial exits without double counting cumulative fill quantities', () => {
    const orders = [intent('buy', 'buy', 10, 100, 0), intent('sell', 'sell', 4, 110, 1)]
    const ledger = fillLedger(orders)
    expect(ledger.realized).toBe(40)
    expect(ledger.lots.get('AAPL')?.[0]?.qty).toBe(6)
    expect(fillLedger(orders).realized).toBe(40)
  })
  it('calculates win/loss metrics, unrealized P/L and benchmark returns', () => {
    const orders = [
      intent('b1', 'buy', 10, 100, 0),
      intent('s1', 'sell', 10, 110, 1),
      intent('b2', 'buy', 5, 100, 2),
      intent('s2', 'sell', 5, 90, 3),
    ]
    const sample: EquitySample = {
      timestamp: testTime,
      accountId: 'paper-test',
      accountEquity: 10000,
      lastEquity: 10000,
      agentPnl: 0,
      unrealizedPnl: 0,
      spyPrice: 500,
    }
    const metrics = performance(
      orders,
      [sample, { ...sample, timestamp: '2026-09-23T20:00:00Z', agentPnl: 50, spyPrice: 510 }],
      fixtureBroker(),
    )
    expect(metrics.realizedPnl).toBe(50)
    expect(metrics.winRate).toBe(0.5)
    expect(metrics.profitFactor).toBe(2)
    expect(metrics.averageWinner).toBe(100)
    expect(metrics.averageLoser).toBe(-50)
    expect(metrics.botReturn).toBeCloseTo(0.005)
    expect(metrics.spyReturn).toBeCloseTo(0.02)
  })
  it('returns null instead of inventing marks when manual activity changes agent holdings', () => {
    const metrics = performance([intent('buy', 'buy', 10, 100, 0)], [], fixtureBroker())
    expect(metrics.unrealizedPnl).toBeNull()
    expect(metrics.warnings).toHaveLength(1)
  })
})
