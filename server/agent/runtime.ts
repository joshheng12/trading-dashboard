import { resolve } from 'node:path'
import { Journal } from '../persistence/journal'
import { tradingConfig } from '../config/trading'
import { AgentController } from './controller'
import { PaperExecution } from './paperExecution'
import { installAgent } from './routes'
import { startScheduler } from './scheduler'

export function startLocalAgent() {
  const journal = new Journal(resolve(process.env.AGENT_DB_PATH ?? 'data/agent.sqlite'))
  // A restart never resumes order automation silently. Emergency latch is preserved.
  journal.setState({ status: 'PAUSED', automaticOrders: false, mode: 'RESEARCH_ONLY', error: null })
  const controller = new AgentController(journal, new PaperExecution(journal, tradingConfig))
  installAgent(controller)
  const stop = startScheduler(controller)
  return {
    controller,
    close: () => {
      stop()
      journal.close()
    },
  }
}
