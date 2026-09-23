import { randomUUID } from 'node:crypto'
import type {
  BrokerSnapshot,
  Decision,
  Evidence,
  MarketRegime,
  OperatingMode,
  ResearchReport,
} from '../../src/types/research'
import { tradingConfig } from '../config/trading'
import type { Journal } from '../persistence/journal'
import { collectEvidence } from '../research/evidence'
import { research, PROMPT_VERSION } from '../research/aiResearch'
import { scan } from './scanner'
import { marketRegime } from './marketRegime'
import { noTrade, strategy } from './strategy'
import { assessRisk, rejectedRisk } from './riskManager'
import { PaperExecution } from './paperExecution'
import { fillLedger, ownedQuantity, performance, tradingDay } from './performance'
import { dailyReview } from './dailyReview'

const services = { config: tradingConfig, collect: collectEvidence, research, scan }
export class AgentController {
  private busy = false
  private executionBusy = false
  private broker: BrokerSnapshot | null = null
  isBusy() {
    return this.busy
  }
  constructor(
    readonly journal: Journal,
    readonly execution: PaperExecution,
    private deps = services,
  ) {}

  control(action: string, mode?: OperatingMode) {
    const c = this.deps.config()
    switch (action) {
      case 'pause':
        this.journal.setState({ status: 'PAUSED', automaticOrders: false })
        break
      case 'resume':
        if (this.journal.state().emergencyStop)
          throw new Error('Clear the emergency stop explicitly before resuming')
        this.journal.setState({ status: 'RUNNING', error: null })
        break
      case 'disable-orders':
        this.journal.setState({ automaticOrders: false, mode: 'RESEARCH_ONLY' })
        break
      case 'emergency-stop':
        this.journal.setState({ emergencyStop: true, automaticOrders: false, status: 'PAUSED' })
        break
      case 'clear-stop':
        this.journal.setState({ emergencyStop: false, status: 'PAUSED', automaticOrders: false })
        break
      case 'mode':
        if (!mode || !['RESEARCH_ONLY', 'MANUAL_APPROVAL', 'AUTO_PAPER'].includes(mode))
          throw new Error('Invalid mode')
        if (mode !== 'RESEARCH_ONLY' && (!c.enabled || c.tradingMode !== 'paper'))
          throw new Error('Paper mode and AI_TRADING_ENABLED=true required')
        if (mode === 'AUTO_PAPER' && (!c.automaticOrders || c.operatingMode !== 'AUTO_PAPER'))
          throw new Error('AUTO_PAPER requires explicit environment opt-in')
        this.journal.setState({ mode, automaticOrders: mode === 'AUTO_PAPER', status: 'PAUSED' })
        break
      default:
        throw new Error('Unknown control action')
    }
    this.journal.event(
      action === 'pause' || action === 'emergency-stop' ? 'AGENT_PAUSED' : 'AGENT_CONTROL_CHANGED',
      null,
      null,
      { action, state: this.journal.state() },
    )
    return this.journal.state()
  }

  status() {
    const config = this.deps.config()
    return {
      state: this.journal.state(),
      busy: this.busy,
      config,
      decisions: this.journal.decisions().map((d) => ({
        ...d,
        evidence: d.evidence
          ? {
              ...d.evidence,
              market: d.evidence.market ? { ...d.evidence.market, candles: [] } : null,
            }
          : null,
      })),
      orders: this.journal.intents(),
      scan:
        this.journal.get<import('./scanner').ScanRow[]>('latest-scan')?.map((row) => ({
          symbol: row.symbol,
          price: row.price,
          rank: row.rank,
          selected: row.selected,
          reasons: row.reasons,
        })) ?? null,
      events: this.journal.events().map((event) => ({ ...event, metadata: null })),
      performance: performance(this.journal.intents(), this.journal.samples(), this.broker),
      dailyReview: this.journal.get('latest-review'),
    }
  }

  async approve(id: string, manual = true) {
    if (this.executionBusy) throw new Error('Another execution is in progress')
    const decision = this.journal.decision(id)
    if (!decision) throw new Error('Decision not found')
    this.executionBusy = true
    try {
      const risk = await this.execution.execute(decision, manual)
      this.journal.event(
        risk.approved ? 'EXECUTION_ACCEPTED' : 'RISK_REJECTED',
        id,
        decision.symbol,
        risk,
      )
      return risk
    } catch (error) {
      this.journal.event('EXECUTION_FAILED', id, decision.symbol)
      this.journal.setState({
        status: 'ERROR',
        automaticOrders: false,
        error: 'Execution failed or awaits reconciliation. Inspect the journal before resuming.',
      })
      throw error
    } finally {
      this.executionBusy = false
    }
  }

  async run() {
    if (this.busy) throw new Error('Research cycle already running')
    this.busy = true
    const cycleId = randomUUID()
    const revision = this.journal.state().revision
    const stopped = () =>
      this.journal.state().emergencyStop || this.journal.state().revision !== revision
    const c = this.deps.config()
    try {
      this.journal.event('SCAN_STARTED', cycleId, null)
      await this.execution.reconcile()
      try {
        this.broker = await this.execution.broker.snapshot()
      } catch {
        this.broker = null
      }
      const rows = await this.deps.scan(c, undefined, stopped)
      this.journal.put('latest-scan', rows)
      this.journal.event('SCAN_COMPLETED', cycleId, null, rows)
      const benchmark = await this.deps.collect('SPY').catch(() => null)
      const regime = marketRegime(benchmark, c, new Date().toISOString())
      if (this.broker) await this.samplePerformance(benchmark?.market?.price ?? null)
      this.journal.event('MARKET_REGIME', cycleId, 'SPY', { regime, evidence: benchmark })
      const owned = [...fillLedger(this.journal.intents()).lots.entries()]
        .filter(([, lots]) => lots.some((lot) => lot.qty > 0))
        .map(([symbol]) => symbol)
      for (const symbol of owned)
        if (!rows.some((row) => row.symbol === symbol))
          rows.push({
            symbol,
            price: null,
            rank: 0,
            selected: true,
            reasons: ['Monitor agent-owned position'],
          })
      for (const row of rows) {
        if (stopped()) break
        const id = randomUUID()
        const at = new Date().toISOString()
        this.journal.event('RESEARCH_STARTED', id, row.symbol)
        if (!row.selected && !owned.includes(row.symbol)) {
          const reasons = row.reasons.length
            ? row.reasons
            : ['Outside configured research candidate limit']
          this.journal.saveDecision({
            scanId: cycleId,
            decisionId: id,
            timestamp: at,
            symbol: row.symbol,
            evidence: null,
            report: null,
            regime,
            signal: noTrade(row.symbol, at, reasons),
            risk: rejectedRisk(...reasons),
            config: c,
            model: c.model,
            promptVersion: PROMPT_VERSION,
            error: null,
          })
          continue
        }
        await this.evaluate(row.symbol, id, regime, stopped, cycleId)
      }
      if (this.broker) await this.samplePerformance(benchmark?.market?.price ?? null)
      this.journal.put('last-cycle', Date.now())
    } catch {
      this.journal.event('SCAN_FAILED', cycleId, null)
      this.journal.setState({
        status: 'ERROR',
        automaticOrders: false,
        error: 'Research cycle failed. No new orders authorized.',
      })
      throw new Error('Research cycle failed; inspect agent journal and configuration')
    } finally {
      this.busy = false
    }
  }

  private async evaluate(
    symbol: string,
    id: string,
    regime: MarketRegime,
    stopped: () => boolean,
    scanId: string,
  ) {
    const c = this.deps.config()
    let evidence: Evidence | null = null
    let report: ResearchReport | null = null
    let error: string | null = null
    let signal = noTrade(symbol, new Date().toISOString(), ['Research not available'])
    let risk = rejectedRisk('Research not available')
    try {
      evidence = await this.deps.collect(symbol)
      if (!evidence.eligible) throw new Error('Evidence unavailable')
      report = await this.deps.research(evidence, regime)
      const at = new Date().toISOString()
      const intents = this.journal.intents()
      const owned = ownedQuantity(intents, symbol)
      signal = strategy(evidence, report, regime, c, at, owned > 0)
      if (signal.signal === 'HOLD' || signal.signal === 'SELL') {
        // HOLD rearms a future entry after a canceled order; positions and intents remain hard gates.
        if (signal.signal === 'HOLD') this.journal.put(`executed-signal:${symbol}`, null)
      }
      try {
        this.broker = await this.execution.broker.snapshot()
      } catch {
        this.broker = null
      }
      if (this.broker) {
        const lastLoss = fillLedger(intents)
          .closed.filter((t) => t.pnl < 0)
          .at(-1)
        risk = assessRisk({
          signal,
          evidence,
          report,
          broker: this.broker,
          state: this.journal.state(),
          config: c,
          now: Date.now(),
          tradesToday: intents.filter((i) => tradingDay(i.createdAt) === tradingDay(at)).length,
          lastLossAt: lastLoss ? Date.parse(lastLoss.timestamp) : null,
          duplicate: this.journal.get<string>(`executed-signal:${symbol}`) === signal.signal,
          unresolvedOrder: intents.some((i) => i.status !== 'TERMINAL'),
          agentOwnedQty: owned,
        })
      } else risk = rejectedRisk('Account data unavailable')
      this.journal.event('RESEARCH_COMPLETED', id, symbol)
    } catch {
      error = 'Research dependency failed, missing configuration, or invalid AI output'
      signal = noTrade(symbol, new Date().toISOString(), [error])
      risk = rejectedRisk(error)
      this.journal.event('RESEARCH_FAILED', id, symbol, { error })
    }
    const decision: Decision = {
      scanId,
      decisionId: id,
      timestamp: signal.timestamp,
      symbol,
      evidence,
      report,
      regime,
      signal,
      risk,
      config: c,
      model: c.model,
      promptVersion: PROMPT_VERSION,
      error,
    }
    this.journal.saveDecision(decision)
    this.journal.put(`latest:${symbol}`, id)
    this.journal.event('SIGNAL_GENERATED', id, symbol, signal)
    this.journal.event(risk.approved ? 'RISK_APPROVED' : 'RISK_REJECTED', id, symbol, {
      risk,
      broker: this.broker,
    })
    const state = this.journal.state()
    if (
      !stopped() &&
      risk.approved &&
      state.mode === 'AUTO_PAPER' &&
      state.automaticOrders &&
      c.automaticOrders &&
      c.enabled
    )
      await this.approve(id, false)
  }

  async samplePerformance(spyPrice: number | null = null) {
    if (spyPrice === null)
      spyPrice = (await this.deps.collect('SPY').catch(() => null))?.market?.price ?? null
    await this.execution.reconcile()
    this.broker = await this.execution.broker.snapshot()
    const expected = this.journal.get<string>('account-id')
    if (expected && expected !== this.broker.accountId) throw new Error('Paper account changed')
    this.journal.put('account-id', this.broker.accountId)
    const metrics = performance(this.journal.intents(), this.journal.samples(), this.broker)
    if (metrics.unrealizedPnl !== null)
      this.journal.sample({
        timestamp: this.broker.timestamp,
        accountId: this.broker.accountId,
        accountEquity: this.broker.equity,
        lastEquity: this.broker.lastEquity,
        agentPnl: metrics.realizedPnl + metrics.unrealizedPnl,
        unrealizedPnl: metrics.unrealizedPnl,
        spyPrice,
      })
    if (metrics.warnings.length)
      this.journal.setState({
        status: 'ERROR',
        automaticOrders: false,
        error: metrics.warnings.join('; '),
      })
    return this.broker
  }

  async review() {
    const broker = await this.samplePerformance()
    if (broker.marketOpen) throw new Error('Daily review is available after the session')
    return dailyReview(this.journal, broker)
  }
}
