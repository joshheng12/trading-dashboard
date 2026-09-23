// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Journal } from '../persistence/journal'
import { AgentController } from './controller'
import { PaperExecution } from './paperExecution'
import { tradingConfig } from '../config/trading'
import { fixtureBroker, fixtureEvidence, fixtureReport, testTime } from './fixtures.test-support'
import type { PaperBroker } from './broker'
import { scan } from './scanner'
import { research } from '../research/aiResearch'
import { collectEvidence } from '../research/evidence'
let journal: Journal
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(testTime))
  vi.stubEnv('TRADING_MODE', 'paper')
  journal = new Journal(':memory:')
})
afterEach(() => {
  journal.close()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
function setup(auto = false) {
  const config = () =>
    tradingConfig({
      TRADING_MODE: 'paper',
      AI_TRADING_ENABLED: 'true',
      AUTO_PAPER_TRADING: auto ? 'true' : 'false',
      AI_OPERATING_MODE: auto ? 'AUTO_PAPER' : 'RESEARCH_ONLY',
    })
  const broker: PaperBroker = {
    snapshot: vi.fn<PaperBroker['snapshot']>().mockResolvedValue(fixtureBroker()),
    submit: vi.fn<PaperBroker['submit']>(),
    cancel: vi.fn<PaperBroker['cancel']>(),
    order: vi.fn<PaperBroker['order']>(),
  }
  vi.mocked(broker.submit).mockImplementation(async (input, clientId) => ({
    id: 'order-1',
    clientOrderId: clientId,
    symbol: input.symbol,
    side: input.side,
    type: input.type,
    timeInForce: 'day',
    status: 'new',
    qty: input.qty,
    filledQty: 0,
    submittedAt: testTime,
  }))
  const market = fixtureEvidence().market!
  market.candles = Array.from({ length: 260 }, (_, i) => ({
    time: Date.parse(testTime) / 1000 - (260 - i) * 86400,
    open: 50 + i * 0.18,
    close: 50 + i * 0.18,
    high: 51 + i * 0.18,
    low: 49 + i * 0.18,
    volume: 1000,
  }))
  const execution = new PaperExecution(journal, config, broker, async () => market)
  const deps = {
    config,
    collect: vi.fn<typeof collectEvidence>().mockResolvedValue(fixtureEvidence()),
    research: vi.fn<typeof research>().mockResolvedValue(fixtureReport()),
    scan: vi
      .fn<typeof scan>()
      .mockResolvedValue([{ symbol: 'AAPL', price: 100, rank: 95, selected: true, reasons: [] }]),
  }
  return { controller: new AgentController(journal, execution, deps), broker, deps }
}
it('research-only cycle persists research and decisions without sending orders', async () => {
  const { controller, broker } = setup()
  await controller.run()
  expect(journal.decisions()).toHaveLength(1)
  expect(journal.decisions()[0]?.report?.symbol).toBe('AAPL')
  expect(broker.submit).not.toHaveBeenCalled()
})
it('AI failures produce permanent NO_TRADE evaluations', async () => {
  const { controller, broker, deps } = setup()
  deps.research.mockRejectedValue(new Error('AI unavailable'))
  await controller.run()
  expect(journal.decisions()[0]?.signal.signal).toBe('NO_TRADE')
  expect(journal.events().some((e) => e.event === 'RESEARCH_FAILED')).toBe(true)
  expect(broker.submit).not.toHaveBeenCalled()
})
it('explicit auto-paper opt-in executes through strategy, risk and durable intent', async () => {
  const { controller, broker } = setup(true)
  controller.control('mode', 'AUTO_PAPER')
  controller.control('resume')
  await controller.run()
  expect(broker.submit).toHaveBeenCalledTimes(1)
  expect(journal.intents()).toHaveLength(1)
  expect(journal.events().some((e) => e.event === 'RISK_APPROVED')).toBe(true)
})
it('auto-paper cannot be enabled without environment opt-in', () => {
  const { controller } = setup()
  expect(() => controller.control('mode', 'AUTO_PAPER')).toThrow('environment opt-in')
})
