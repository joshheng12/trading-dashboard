# Local AI research and paper-trading agent

The existing dashboard is extended at `/ai-research`. The default is **paused, research-only**, including after every server restart. No live broker host is supported. The LLM receives market evidence and can return only a validated research report; it has no order tools or position-sizing authority.

## Run locally

Use Node 24.12+ (tested on 24.19; Node's built-in SQLite provides persistence) and the existing `npm install` / `npm run dev` workflow. Vite serves the dashboard and Hono serves `/api`. The local server initializes `data/agent.sqlite`; this directory and SQLite sidecars are gitignored. The agent routes return 503 in the existing Netlify function because that deployment has no durable local agent runtime. Existing dashboard routes still work there.

Retain your existing Alpaca paper, Finnhub and owner-session credentials in `.env.local`. Add these settings without committing that file:

```dotenv
TRADING_MODE=paper
AI_TRADING_ENABLED=false
AUTO_PAPER_TRADING=false
AI_OPERATING_MODE=RESEARCH_ONLY
OPENAI_API_KEY=your-server-side-key
OPENAI_RESEARCH_MODEL=your-available-structured-output-model
AGENT_DB_PATH=data/agent.sqlite
```

No model is silently selected. The research service uses the [OpenAI Responses structured-output format](https://developers.openai.com/api/docs/guides/structured-outputs), a bounded response schema, `store:false`, no tools, and a 45-second timeout. It validates the JSON locally, including bounded scores, matching symbol and supplied-news citations. Unsupported model configuration, refusals, timeouts and malformed responses become journaled NO_TRADE decisions. No paid API request is needed for the test suite.

Sign in with the existing owner passcode, open **AI Research**, and select **Run Research Now**. This performs deterministic scanning before spending AI calls on selected candidates. Clicking a ticker opens the report, deterministic reasons, stored inputs/configuration and execution event history. Research can be run on demand while automation is disabled. Outside market hours, missing/current-session data often excludes candidates; this is deliberate.

## Operating modes

| Mode | Behavior |
| --- | --- |
| RESEARCH_ONLY | Reports and decisions only; cannot place agent orders |
| MANUAL_APPROVAL | A proposal can be explicitly approved in its detail view; fresh strategy/risk checks still apply |
| AUTO_PAPER | A running scheduler may execute only approved paper signals; environment and dashboard opt-ins both required |

For manual paper evaluation, set `AI_TRADING_ENABLED=true`, keep `AUTO_PAPER_TRADING=false`, restart, then use **Set mode and pause** with MANUAL_APPROVAL and **Resume Agent**. `AI_TRADING_ENABLED` permits scheduling and paper execution; the operating mode still gates every execution. BUY proposals expire after `MAX_PRICE_AGE_MS` (120 seconds by default); rerun research rather than approve stale evidence. Sizing uses a fixed-dollar budget or a portfolio fraction, constrained by exposure/cash limits. Whole-share buy limits may result in NO_TRADE when one share costs more than the allowed budget. SELL only reduces agent-owned long shares with matching broker quantities; no shorting or automatic liquidation is implemented.

For automation, first validate manual workflows with your provider entitlements. Explicitly set all of:

```dotenv
TRADING_MODE=paper
AI_TRADING_ENABLED=true
AUTO_PAPER_TRADING=true
AI_OPERATING_MODE=AUTO_PAPER
```

After restart, select AUTO_PAPER in the dashboard, apply the mode, then resume. These steps do not change strategy parameters. **Pause**, **Disable Automatic Paper Orders**, and **Emergency Stop** take effect on subsequent submissions and on in-flight research before submission. A request already sent to Alpaca cannot be recalled by pausing. Emergency Stop does not liquidate positions or itself cancel orders. A separate per-order cancel action is available. Working agent orders older than `ORDER_MAX_AGE_MS` are canceled by reconciliation, with broker confirmation still required.

## Execution and crash recovery

1. A unique decision ID and research-start event are written before each evaluation. Scanner snapshots and SPY context are retained under its linked scan ID.
2. The immutable decision stores evidence, report, regime, strategy output, initial risk decision, config, model and prompt version. Later approvals append fresh inputs/risk results instead of replacing history.
3. A database execution lease serializes fresh risk checks across local workers. SQLite transactions reserve a unique client order ID before the broker request. Any unresolved intent blocks additional agent orders.
4. The existing Alpaca order implementation submits the paper limit/market order. Responses and later cumulative fills are appended as events; the intent's current status is a projection, not the historical source of truth.
5. Ambiguous network failures retain UNKNOWN status. Reconciliation looks up the same client order ID and **never resubmits**. A not-found response alone is not treated as proof that submission failed.

If an UNKNOWN intent cannot be resolved, stop the agent and inspect that client ID in Alpaca and the journal. This implementation intentionally has no “force clear and retry” button. Do not delete the database to bypass duplicate protection. An abandoned execution lease expires after five minutes, but the durable intent remains a separate block. Journal failure prevents execution. Always use one database per paper account; changing the account ID blocks operation. Avoid manually trading an agent-owned symbol: a quantity mismatch disables automation and prevents reliable mark/exit attribution. Backup SQLite only after stopping the local server, or use a SQLite-aware online backup that includes WAL contents.

## Scheduler and performance

The local scheduler has serial ticks, configured scan intervals, a pre-market window based on Alpaca's next-open time, periodic market-open evaluation, reconciliation, performance sampling, and an after-close daily review. Defaults are in `.env.example` and `server/config/trading.ts`. No strategy parameter is self-modified. A paused/emergency-stopped agent can still reconcile existing orders; it cannot initiate new ones. A failed critical dependency pauses execution in ERROR or records a rejected decision.

Performance uses the agent's cumulative fills to reconstruct FIFO entry/exit lots, realized P/L, open marks, wins/losses, profit factor and sampled drawdown. Manual holdings are excluded from agent P/L. “Agent return” is agent P/L divided by initial account equity (not total account return); account equity is displayed separately. This avoids attributing deposits or manual trades to strategy profit. SPY is a price-return comparison from recorded observation points, without dividends. Missing benchmark/position marks remain unavailable. Partial/canceled order fills are retained; exchange fees, dividends and corporate actions are not yet separately imported into agent P/L. Shared-account/manual activity and sparse sampling limit interpretation.

The daily review is calculated in code and stored once per New York date. It includes equity, daily agent P/L, benchmark return, closed trades, best/worst trade, rejected evaluations and observations. It does not invoke an LLM or change settings. After-close scheduling currently uses 16:00 New York as its review threshold; early-close sessions are reviewed later that afternoon. Downtime does not synthesize missed historical reports.

## Historical replay

`npm run backtest -- archived-frames.json results.json` runs the same `strategy()` and `assessRisk()` as the paper workflow with a simulated execution layer. The CLI defaults to $100,000 starting equity; programmatic callers can supply starting equity, per-order fees, slippage and configuration. No API or brokerage credentials are used.

Each input is a `ReplayFrame` from `server/backtest/engine.ts`: evaluation timestamp, archived Evidence, archived ResearchReport, report availability timestamp, archived regime, and a strictly later execution bar. See the engine tests for a complete programmatic example. All evidence timestamps must be at or before evaluation; daily candles must be from completed earlier sessions. JSON reports are schema-validated. Never import today's fundamentals into old frames or regenerate historical research using a model with later knowledge. The importer validates declared timestamps, not the authenticity of your archive.

Execution is deliberately conservative: buys can fill only at the next bar's open if within the approved limit; intrabar low touches are not used before they are known. Fees/slippage are explicit. The simulator does not model queue position, partial fills, liquidity, corporate actions, survivorship bias or exchange sessions itself; provide genuine market-session frames. It is a reproducible replay foundation, not a profitability claim or a historical data acquisition service.

## Verification

Run `npm run type-check`, `npm run lint`, `npm run test:unit -- --run`, and `npm run build`. Tests mock provider/network boundaries and use temporary/in-memory SQLite. They cover indicators, schema failures, strategy classification, risk limits, sizing, stale evidence, market closure, live-host rejection, provider failures, durable reservations, duplicate/restart protection, emergency controls, fill accounting, research-only/auto-paper orchestration and replay look-ahead rejection. Real provider entitlements and simulated broker fills still require an explicitly configured local paper session; they are not implied by passing mocks.
