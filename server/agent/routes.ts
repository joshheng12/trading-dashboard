import { Hono } from 'hono'
import { requireAuth } from '../auth'
import type { AgentController } from './controller'
import type { OperatingMode } from '../../src/types/research'

let controller: AgentController | null = null
export function installAgent(value: AgentController | null) {
  controller = value
}
export const agentRoutes = new Hono()
agentRoutes.use('*', requireAuth)
agentRoutes.use('*', async (c, next) => {
  if (!controller)
    return c.json({ error: 'Agent requires the local Node server and durable local journal.' }, 503)
  if (c.req.method !== 'GET') {
    const origin = c.req.header('origin')
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host')
    const fetchSite = c.req.header('sec-fetch-site')
    if (fetchSite === 'cross-site')
      return c.json({ error: 'Cross-site agent writes rejected' }, 403)
    if (origin && (!host || new URL(origin).host !== host))
      return c.json({ error: 'Origin mismatch' }, 403)
    if (!c.req.header('content-type')?.startsWith('application/json'))
      return c.json({ error: 'JSON body required' }, 415)
  }
  await next()
})
agentRoutes.onError((error, c) =>
  c.json(
    {
      error: error.message.startsWith('SQLITE')
        ? 'Journal unavailable; execution blocked'
        : error.message,
    },
    400,
  ),
)
agentRoutes.get('/status', (c) => c.json(controller!.status()))
agentRoutes.get('/decisions/:id', (c) => {
  const decision = controller!.journal.decision(c.req.param('id'))
  return decision
    ? c.json({
        decision,
        events: [
          ...controller!.journal.events(decision.decisionId),
          ...(decision.scanId ? controller!.journal.events(decision.scanId) : []),
        ],
      })
    : c.json({ error: 'Decision not found' }, 404)
})
agentRoutes.post('/research', async (c) => {
  await controller!.run()
  return c.json(controller!.status())
})
agentRoutes.post('/controls', async (c) => {
  const body = (await c.req.json()) as { action?: unknown; mode?: unknown }
  if (typeof body.action !== 'string') return c.json({ error: 'Action required' }, 400)
  return c.json(
    controller!.control(
      body.action,
      typeof body.mode === 'string' ? (body.mode as OperatingMode) : undefined,
    ),
  )
})
agentRoutes.post('/decisions/:id/approve', async (c) =>
  c.json(await controller!.approve(c.req.param('id'))),
)
agentRoutes.post('/decisions/:id/cancel', async (c) => {
  await controller!.execution.cancel(c.req.param('id'))
  return c.json({ ok: true })
})
agentRoutes.post('/review', async (c) => c.json(await controller!.review()))
agentRoutes.post('/reconcile', async (c) => {
  await controller!.execution.reconcile()
  return c.json(controller!.status())
})
