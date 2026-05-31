/**
 * The Hono application: middleware + route wiring.
 *
 * This module owns no transport details, so the same `app` is shared by both entry
 * points — `dev.ts` (Bun server, local) and `index.ts` (Lambda handler, prod).
 */
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'
import { logger } from 'hono/logger'
import { config } from './lib/config'
import { documents } from './routes/documents'
import { chat } from './routes/chat'

export const app = new Hono()

// CORS first — the browser frontend lives on a different origin, and the preflight
// OPTIONS request carries no credentials, so it must pass *before* basic auth.
const allowedOrigins = config.corsOrigins.split(',').map((o) => o.trim())
app.use('*', cors({
  origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}))

app.use(logger())

// Public liveness check — registered before the auth middleware so it stays open.
app.get('/health', prettyJSON(), (c) => c.json({ status: 'ok' }))

// Everything below this line requires HTTP Basic Auth (credentials from env).
app.use('*', basicAuth({ username: config.auth.username, password: config.auth.password }))

app.route('/documents', documents)
app.route('/chat', chat)
