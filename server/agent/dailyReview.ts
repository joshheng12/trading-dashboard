import type { Journal } from '../persistence/journal'
import type { BrokerSnapshot } from '../../src/types/research'
import { performance, tradingDay } from './performance'

/** Deterministic daily review. No model can alter configuration or historical records. */
export function dailyReview(
  journal: Journal,
  broker: BrokerSnapshot,
  now = new Date().toISOString(),
) {
  const date = tradingDay(now)
  const existing = journal.get<ReturnType<typeof buildReview>>(`review:${date}`)
  if (existing) return existing
  const report = buildReview(journal, broker, date)
  journal.put(`review:${date}`, report)
  journal.put('latest-review', report)
  journal.event('DAILY_REVIEW_COMPLETED', null, null, report)
  return report
}

function buildReview(journal: Journal, broker: BrokerSnapshot, date: string) {
  const all = journal.samples()
  const samples = all.filter((sample) => tradingDay(sample.timestamp) === date)
  const previous = all.filter((sample) => tradingDay(sample.timestamp) < date).at(-1)
  const metrics = performance(journal.intents(), all, broker)
  const trades = metrics.closedTrades.filter((t) => tradingDay(t.timestamp) === date)
  const decisions = journal.decisions(100000).filter((d) => tradingDay(d.timestamp) === date)
  const sorted = [...trades].sort((a, b) => b.pnl - a.pnl)
  return {
    date,
    startingEquity: previous?.accountEquity ?? samples[0]?.accountEquity ?? null,
    endingEquity: samples.at(-1)?.accountEquity ?? null,
    dailyAgentPnl: samples.length
      ? samples.at(-1)!.agentPnl - (previous?.agentPnl ?? samples[0]!.agentPnl)
      : null,
    benchmarkReturn:
      (previous?.spyPrice ?? samples[0]?.spyPrice) && samples.at(-1)?.spyPrice
        ? samples.at(-1)!.spyPrice! / (previous?.spyPrice ?? samples[0]!.spyPrice!) - 1
        : null,
    trades,
    bestTrade: sorted[0] ?? null,
    worstTrade: sorted.at(-1) ?? null,
    rejectedTrades: decisions.filter((d) => !d.risk.approved).length,
    strategyObservations: [
      'Parameters unchanged. Short testing periods cannot establish profitability.',
    ],
    riskObservations: [...new Set(decisions.flatMap((d) => d.risk.reasons))],
  }
}
