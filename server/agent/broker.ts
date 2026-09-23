import {
  fetchTradingAccount,
  fetchTradingOrders,
  fetchTradingPositions,
  placeOrder,
  cancelOrder,
  fetchOrderByClientId,
} from '../alpaca'
import { fetchClock } from '../markets'
import type { BrokerSnapshot } from '../../src/types/research'
import { symbolValue } from '../research/validation'

function number(value: unknown): number {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (typeof value !== 'string' && typeof value !== 'number')
  )
    throw new Error('Missing broker numeric field')
  const result = Number(value)
  if (!Number.isFinite(result)) throw new Error('Invalid broker numeric field')
  return result
}

/** Fresh uncached reads reuse the dashboard broker transport, with stricter risk DTO validation. */
export async function brokerSnapshot(): Promise<BrokerSnapshot> {
  const [a, positions, pending, clock] = await Promise.all([
    fetchTradingAccount(),
    fetchTradingPositions(),
    fetchTradingOrders('open', 500),
    fetchClock(true),
  ])
  if (
    !a.id ||
    typeof a.trading_blocked !== 'boolean' ||
    typeof a.account_blocked !== 'boolean' ||
    typeof clock.isOpen !== 'boolean' ||
    !Array.isArray(positions) ||
    !Array.isArray(pending)
  )
    throw new Error('Incomplete broker state')
  if (![clock.nextOpen, clock.nextClose].every((t) => Number.isFinite(Date.parse(t))))
    throw new Error('Invalid market clock')
  return {
    timestamp: new Date().toISOString(),
    accountId: a.id,
    equity: number(a.equity),
    lastEquity: number(a.last_equity),
    cash: number(a.cash),
    buyingPower: number(a.buying_power),
    blocked: a.status !== 'ACTIVE' || a.trading_blocked || a.account_blocked,
    marketOpen: clock.isOpen,
    nextOpen: clock.nextOpen,
    nextClose: clock.nextClose,
    positions: positions.map((p) => ({
      symbol: symbolValue(p.symbol),
      qty: number(p.qty),
      marketValue: number(p.market_value),
      price: number(p.current_price),
    })),
    pendingSymbols: pending.map((o) => symbolValue(o.symbol)),
  }
}

export const paperBroker = {
  snapshot: brokerSnapshot,
  submit: placeOrder,
  cancel: cancelOrder,
  order: fetchOrderByClientId,
}
export type PaperBroker = typeof paperBroker
