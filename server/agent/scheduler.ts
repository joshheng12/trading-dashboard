import type { AgentController } from './controller'
import { tradingConfig } from '../config/trading'
import { collectEvidence } from '../research/evidence'
import { tradingDay } from './performance'

/** Local process scheduler, serial ticks; never mounted inside a serverless function. */
export function startScheduler(controller: AgentController) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const c = tradingConfig()
      if (!c.enabled) return
      await controller.execution.reconcile()
      const state = controller.journal.state()
      if (state.status !== 'RUNNING' || state.emergencyStop) return
      if (controller.isBusy()) return
      const broker = await controller.execution.broker.snapshot()
      const now = Date.now()
      const untilOpen = Date.parse(broker.nextOpen) - now
      const due = now - (controller.journal.get<number>('last-cycle') ?? 0) >= c.scanIntervalMs
      if (
        due &&
        (broker.marketOpen || (untilOpen > 0 && untilOpen <= c.premarketMinutes * 60_000))
      ) {
        await controller.run()
      }
      if (now - (controller.journal.get<number>('last-performance') ?? 0) >= 300_000) {
        const benchmark = await collectEvidence('SPY').catch(() => null)
        await controller.samplePerformance(benchmark?.market?.price ?? null)
        controller.journal.put('last-performance', now)
      }
      const nyHour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: '2-digit',
          hourCycle: 'h23',
        }).format(now),
      )
      const day = tradingDay(new Date(now).toISOString())
      if (
        !broker.marketOpen &&
        nyHour >= 16 &&
        !controller.journal.get(`review:${day}`) &&
        controller.journal.samples().some((s) => tradingDay(s.timestamp) === day)
      )
        await controller.review()
    } catch {
      controller.journal.setState({
        status: 'ERROR',
        automaticOrders: false,
        error: 'Scheduler dependency failed. Review configuration and journal before resuming.',
      })
      controller.journal.event('SCHEDULER_FAILED', null, null)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => {
    void tick().catch(() => {
      /* DB failure leaves no execution path; durable intent is retained. */
    })
  }, tradingConfig().schedulerTickMs)
  timer.unref()
  return () => clearInterval(timer)
}
