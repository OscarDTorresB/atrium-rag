import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { config } from './lib/config'
import { documents } from './routes/documents'
import { chat } from './routes/chat'

export const app = new Hono()

// Public liveness check — registered before the auth middleware so it stays open.
app.get('/health', (c) => c.json({ status: 'ok' }))

// Everything below this line requires HTTP Basic Auth (credentials from env).
app.use('*', basicAuth({ username: config.auth.username, password: config.auth.password }))

app.route('/documents', documents)
app.route('/chat', chat)
