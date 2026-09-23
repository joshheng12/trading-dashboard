// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Journal } from '../persistence/journal'
import { PaperExecution } from './paperExecution'
import { tradingConfig } from '../config/trading'
import { fixtureBroker, fixtureDecision, fixtureEvidence, testTime } from './fixtures.test-support'
import type { PaperBroker } from './broker'
import type { Order } from '../../src/types/market'
import { AgentController } from './controller'

let journal: Journal
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(testTime))
  vi.stubEnv('TRADING_MODE', 'paper')
  journal = new Journal(':memory:')
  journal.setState({ status: 'RUNNING', mode: 'MANUAL_APPROVAL' })
  journal.saveDecision(fixtureDecision())
  journal.put('latest:AAPL', 'test-decision')
})
afterEach(() => {
  journal.close()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const config = () => tradingConfig({ TRADING_MODE: 'paper', AI_TRADING_ENABLED: 'true' })
function setup() {
  const accepted: Order = {
    id: 'broker-1',
    clientOrderId: 'ai-test-decision',
    symbol: 'AAPL',
    side: 'buy',
    type: 'limit',
    timeInForce: 'day',
    status: 'new',
    qty: 1,
    filledQty: 0,
    submittedAt: testTime,
  }
  const broker: PaperBroker = {
    snapshot: vi.fn<PaperBroker['snapshot']>().mockResolvedValue(fixtureBroker()),
    submit: vi.fn<PaperBroker['submit']>().mockResolvedValue(accepted),
    cancel: vi.fn<PaperBroker['cancel']>().mockResolvedValue(undefined),
    order: vi.fn<PaperBroker['order']>().mockResolvedValue(accepted),
  }
  const market = fixtureEvidence().market!
  market.candles = Array.from({ length: 260 }, (_, i) => ({
    time: Date.parse(testTime) / 1000 - (260 - i) * 86400,
    open: 50 + i * 0.18,
    close: 50 + i * 0.18,
    high: 51 + i * 0.18,
    low: 49 + i * 0.18,
    volume: 1000,
  }))
  const getMarket = vi.fn<() => Promise<typeof market>>().mockResolvedValue(market)
  return { broker, accepted, execution: new PaperExecution(journal, config, broker, getMarket) }
}
describe('durable execution', () => {
  it('persists an intent before sending one paper order and prevents duplicate approval', async () => {
    const { execution, broker } = setup()
    vi.mocked(broker.submit).mockImplementation(async (_input, clientId) => {
      expect(journal.intent('test-decision')?.status).toBe('RESERVED')
      return {
        id: 'broker-1',
        clientOrderId: clientId,
        symbol: 'AAPL',
        side: 'buy',
        type: 'limit',
        timeInForce: 'day',
        status: 'new',
        qty: 1,
        filledQty: 0,
        submittedAt: testTime,
      }
    })
    expect((await execution.execute(fixtureDecision(), true)).approved).toBe(true)
    expect((await execution.execute(fixtureDecision(), true)).approved).toBe(false)
    expect(broker.submit).toHaveBeenCalledTimes(1)
  })
  it('retains unknown broker outcomes and never blindly retries', async () => {
    const { execution, broker } = setup()
    vi.mocked(broker.submit).mockRejectedValue(new Error('timeout'))
    vi.mocked(broker.order).mockRejectedValue(new Error('not yet visible'))
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('outcome unknown')
    expect(journal.intent('test-decision')?.status).toBe('UNKNOWN')
    expect((await execution.execute(fixtureDecision(), true)).approved).toBe(false)
    expect(broker.submit).toHaveBeenCalledTimes(1)
  })
  it('reconciles fills into append-only events without rewriting the decision', async () => {
    const { execution, broker, accepted } = setup()
    const before = journal.decision('test-decision')
    await execution.execute(fixtureDecision(), true)
    vi.mocked(broker.order).mockResolvedValue({
      ...accepted,
      status: 'filled',
      filledQty: 1,
      filledAvgPrice: 100,
      filledAt: testTime,
    })
    await execution.reconcile()
    expect(journal.intent('test-decision')?.status).toBe('TERMINAL')
    expect(journal.events('test-decision').some((e) => e.event === 'ORDER_FILLED')).toBe(true)
    expect(journal.decision('test-decision')).toEqual(before)
    expect(() => journal.saveDecision(fixtureDecision())).toThrow(Error)
  })
  it('blocks research-only, live mode, and failed account dependencies', async () => {
    const { execution, broker } = setup()
    journal.setState({ mode: 'RESEARCH_ONLY' })
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('mode')
    journal.setState({ mode: 'MANUAL_APPROVAL' })
    vi.stubEnv('TRADING_MODE', 'live')
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('TRADING_MODE=paper')
    vi.stubEnv('TRADING_MODE', 'paper')
    vi.mocked(broker.snapshot).mockRejectedValue(new Error('Alpaca unavailable'))
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('Alpaca unavailable')
    expect(broker.submit).not.toHaveBeenCalled()
  })
  it('honors emergency stop arriving during fresh broker reads', async () => {
    const { execution, broker } = setup()
    vi.mocked(broker.snapshot).mockImplementation(async () => {
      journal.setState({ emergencyStop: true, status: 'PAUSED' })
      return fixtureBroker()
    })
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('controls changed')
    expect(broker.submit).not.toHaveBeenCalled()
  })
  it('does not submit when the journal cannot reserve the order', async () => {
    const { execution, broker } = setup()
    vi.spyOn(journal, 'reserve').mockImplementation(() => {
      throw new Error('disk full')
    })
    await expect(execution.execute(fixtureDecision(), true)).rejects.toThrow('disk full')
    expect(broker.submit).not.toHaveBeenCalled()
  })
  it('uses a database lease to serialize fresh risk checks across workers', () => {
    journal.acquireExecution('one')
    expect(() => journal.acquireExecution('two')).toThrow(Error)
    journal.releaseExecution('one')
    expect(() => journal.acquireExecution('two')).not.toThrow()
  })
  it('emergency stop never liquidates positions or cancels orders', () => {
    const { execution, broker } = setup()
    const controller = new AgentController(journal, execution)
    expect(controller.control('emergency-stop')).toMatchObject({
      status: 'PAUSED',
      emergencyStop: true,
      automaticOrders: false,
    })
    expect(broker.submit).not.toHaveBeenCalled()
    expect(broker.cancel).not.toHaveBeenCalled()
    expect(() => controller.control('resume')).toThrow('Clear the emergency stop')
  })
})
