import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AgentState,
  Decision,
  EquitySample,
  JournalEvent,
  OrderIntent,
} from '../../src/types/research'
import type { Order } from '../../src/types/market'
import { logEvent } from '../agent/logger'

type Row = Record<string, unknown>
const decode = <T>(row: Row | undefined): T | null =>
  row ? (JSON.parse(String(row.payload)) as T) : null

/** SQLite is local-only. Decisions/events are append-only; broker state is a materialized projection. */
export class Journal {
  private db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, symbol TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, event TEXT NOT NULL, decisionId TEXT, symbol TEXT, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS intents(id TEXT PRIMARY KEY, symbol TEXT NOT NULL, clientId TEXT UNIQUE NOT NULL, active INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS one_active_symbol ON intents(symbol) WHERE active=1;
      CREATE TABLE IF NOT EXISTS values_store(key TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS equity(timestamp TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS execution_lock(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS decisions_no_update BEFORE UPDATE ON decisions BEGIN SELECT RAISE(ABORT,'immutable decision'); END;
      CREATE TRIGGER IF NOT EXISTS decisions_no_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT,'immutable decision'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'immutable event'); END;
      PRAGMA user_version=1;`)
    this.db.prepare('INSERT OR IGNORE INTO state VALUES(1,?)').run(
      JSON.stringify({
        status: 'PAUSED',
        mode: 'RESEARCH_ONLY',
        automaticOrders: false,
        emergencyStop: false,
        error: null,
        revision: 0,
      } satisfies AgentState),
    )
  }
  close() {
    this.db.close()
  }
  acquireExecution(owner: string): void {
    this.transaction(() => {
      // An expired lease can only be reclaimed before a new fresh risk read. Reserved intents remain a separate hard gate.
      this.db.prepare('DELETE FROM execution_lock WHERE expires<?').run(Date.now())
      this.db.prepare('INSERT INTO execution_lock VALUES(1,?,?)').run(owner, Date.now() + 300_000)
    })
  }
  releaseExecution(owner: string) {
    this.db.prepare('DELETE FROM execution_lock WHERE owner=?').run(owner)
  }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  state(): AgentState {
    return decode<AgentState>(this.db.prepare('SELECT payload FROM state WHERE id=1').get())!
  }
  setState(patch: Partial<Omit<AgentState, 'revision'>>): AgentState {
    return this.transaction(() => {
      const current = this.state()
      const next = { ...current, ...patch, revision: current.revision + 1 }
      this.db.prepare('UPDATE state SET payload=? WHERE id=1').run(JSON.stringify(next))
      return next
    })
  }
  put(key: string, value: unknown) {
    this.db
      .prepare('INSERT OR REPLACE INTO values_store VALUES(?,?)')
      .run(key, JSON.stringify(value))
  }
  get<T>(key: string): T | null {
    return decode<T>(this.db.prepare('SELECT payload FROM values_store WHERE key=?').get(key))
  }
  event(event: string, decisionId: string | null, symbol: string | null, metadata: unknown = {}) {
    this.db
      .prepare('INSERT INTO events(timestamp,event,decisionId,symbol,payload) VALUES(?,?,?,?,?)')
      .run(new Date().toISOString(), event, decisionId, symbol, JSON.stringify(metadata))
    logEvent(event, symbol, decisionId)
  }
  events(decisionId?: string): JournalEvent[] {
    const rows = decisionId
      ? this.db.prepare('SELECT * FROM events WHERE decisionId=? ORDER BY id').all(decisionId)
      : this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 200').all()
    return rows.map((row) => ({
      id: Number(row.id),
      timestamp: String(row.timestamp),
      event: String(row.event),
      decisionId: row.decisionId === null ? null : String(row.decisionId),
      symbol: row.symbol === null ? null : String(row.symbol),
      metadata: JSON.parse(String(row.payload)) as unknown,
    }))
  }
  saveDecision(decision: Decision) {
    this.db
      .prepare('INSERT INTO decisions VALUES(?,?,?,?)')
      .run(decision.decisionId, decision.timestamp, decision.symbol, JSON.stringify(decision))
  }
  decision(id: string): Decision | null {
    return decode<Decision>(this.db.prepare('SELECT payload FROM decisions WHERE id=?').get(id))
  }
  decisions(limit = 100): Decision[] {
    return this.db
      .prepare('SELECT payload FROM decisions ORDER BY timestamp DESC LIMIT ?')
      .all(limit)
      .map((row) => decode<Decision>(row)!)
  }
  intents(): OrderIntent[] {
    return this.db
      .prepare('SELECT payload FROM intents ORDER BY rowid')
      .all()
      .map((row) => decode<OrderIntent>(row)!)
  }
  intent(id: string): OrderIntent | null {
    return decode<OrderIntent>(this.db.prepare('SELECT payload FROM intents WHERE id=?').get(id))
  }
  /** Atomic durable intent precedes the network write. Unknown outcomes keep this reservation active. */
  reserve(
    intent: OrderIntent,
    revision: number,
    maxTrades: number,
    day: string,
    dayOf: (timestamp: string) => string,
    lockOwner: string,
  ) {
    this.transaction(() => {
      const state = this.state()
      const lease = this.db.prepare('SELECT owner,expires FROM execution_lock WHERE id=1').get()
      if (lease?.owner !== lockOwner || Number(lease.expires) <= Date.now())
        throw new Error('Execution lease expired before reservation')
      if (
        state.revision !== revision ||
        state.emergencyStop ||
        state.status !== 'RUNNING' ||
        state.mode === 'RESEARCH_ONLY'
      )
        throw new Error('Agent controls changed before execution')
      if (this.intents().some((i) => i.status !== 'TERMINAL'))
        throw new Error('An unresolved intent already exists')
      if (this.intents().filter((i) => dayOf(i.createdAt) === day).length >= maxTrades)
        throw new Error('Daily trade reservation limit reached')
      if (!this.decision(intent.decisionId)) throw new Error('Decision not persisted')
      if (this.get<string>(`latest:${intent.symbol}`) !== intent.decisionId)
        throw new Error('Proposal superseded before reservation')
      this.db
        .prepare('INSERT INTO intents VALUES(?,?,?,?,?)')
        .run(intent.decisionId, intent.symbol, intent.clientOrderId, 1, JSON.stringify(intent))
      this.event('ORDER_RESERVED', intent.decisionId, intent.symbol, intent)
    })
  }
  updateIntent(intent: OrderIntent, order: Order | null, status: OrderIntent['status']) {
    this.transaction(() => {
      const current = this.intent(intent.decisionId)
      if (!current) throw new Error('Unknown intent')
      // Concurrent polling must not erase fills or regress a terminal order back to working.
      if (
        (current.status === 'TERMINAL' && status !== 'TERMINAL') ||
        (current.order && !order) ||
        (current.order && order && current.order.filledQty > order.filledQty)
      )
        return
      this.db
        .prepare('UPDATE intents SET active=?,payload=? WHERE id=?')
        .run(
          status === 'TERMINAL' ? 0 : 1,
          JSON.stringify({ ...intent, order, status }),
          intent.decisionId,
        )
      this.event(
        order?.status === 'filled'
          ? 'ORDER_FILLED'
          : order?.status === 'canceled'
            ? 'ORDER_CANCELLED'
            : order?.status === 'rejected'
              ? 'ORDER_REJECTED'
              : order
                ? 'ORDER_SUBMITTED'
                : 'ORDER_UNKNOWN',
        intent.decisionId,
        intent.symbol,
        { order, status },
      )
    })
  }
  sample(sample: EquitySample) {
    this.db
      .prepare('INSERT OR IGNORE INTO equity VALUES(?,?)')
      .run(sample.timestamp, JSON.stringify(sample))
  }
  samples(): EquitySample[] {
    return this.db
      .prepare('SELECT payload FROM equity ORDER BY timestamp')
      .all()
      .map((row) => decode<EquitySample>(row)!)
  }
}
