// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { app } from '../app'
import { installAgent } from './routes'
import { Journal } from '../persistence/journal'
import { AgentController } from './controller'
import { PaperExecution } from './paperExecution'
import { tradingConfig } from '../config/trading'

let journal: Journal
let cookie: string
beforeEach(async () => {
  vi.stubEnv('APP_PASSCODE', 'route-test-passcode')
  vi.stubEnv('SESSION_SECRET', 'route-test-session-secret')
  journal = new Journal(':memory:')
  installAgent(new AgentController(journal, new PaperExecution(journal, tradingConfig)))
  const login = await app.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: 'route-test-passcode' }),
  })
  cookie = login.headers.get('set-cookie')!.split(';')[0]!
})
afterEach(() => {
  installAgent(null)
  journal.close()
  vi.unstubAllEnvs()
})
it('protects the agent journal and status with the existing owner session', async () => {
  expect((await app.request('/api/agent/status')).status).toBe(401)
  expect((await app.request('/api/agent/status', { headers: { cookie } })).status).toBe(200)
})
it('accepts authenticated writes from the original Vite frontend host', async () => {
  const response = await app.request('/api/agent/controls', {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': 'application/json',
      host: 'localhost:8787',
      'x-forwarded-host': 'localhost:5173',
      origin: 'http://localhost:5173',
    },
    body: JSON.stringify({ action: 'emergency-stop' }),
  })
  expect(response.status).toBe(200)
  expect(journal.state().emergencyStop).toBe(true)
})
it('rejects cross-origin writes and non-JSON requests', async () => {
  const response = await app.request('/api/agent/controls', {
    method: 'POST',
    headers: {
      cookie,
      'Content-Type': 'application/json',
      host: 'localhost:8787',
      origin: 'https://untrusted.example',
    },
    body: JSON.stringify({ action: 'resume' }),
  })
  expect(response.status).toBe(403)
  expect(
    (
      await app.request('/api/agent/controls', {
        method: 'POST',
        headers: { cookie },
        body: 'action=resume',
      })
    ).status,
  ).toBe(415)
  expect(journal.state().status).toBe('PAUSED')
})
it('fails closed when no durable local runtime is installed', async () => {
  installAgent(null)
  expect((await app.request('/api/agent/status', { headers: { cookie } })).status).toBe(503)
})
