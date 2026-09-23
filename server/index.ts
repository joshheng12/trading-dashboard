import { config } from 'dotenv'
import { serve } from '@hono/node-server'

// Local dev only: load secrets from .env.local. In production (Netlify
// Functions), env vars are injected by the platform and this file isn't used
// at all — netlify/functions/api.ts mounts `app` directly.
config({ path: '.env.local' })

// Load provider host configuration after dotenv, then mount the local-only durable agent.
const { app } = await import('./app')
const { startLocalAgent } = await import('./agent/runtime')
const agent = startLocalAgent()
process.once('SIGTERM', () => {
  agent.close()
  process.exit(0)
})
process.once('SIGINT', () => {
  agent.close()
  process.exit(0)
})

const port = Number(process.env.PORT) || 8787
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[bff] listening on http://localhost:${info.port}`)
})
