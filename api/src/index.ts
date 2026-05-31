import { streamHandle } from 'hono/aws-lambda'
import { app } from './app'

// streamHandle (vs. handle) lets /chat stream tokens over a Function URL configured
// with InvokeMode RESPONSE_STREAM. Buffered JSON routes still work unchanged.
export const handler = streamHandle(app)
