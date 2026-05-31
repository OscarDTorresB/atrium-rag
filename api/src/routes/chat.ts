/**
 * Streaming RAG chat:
 *   POST /chat { message, documentId?, topK? }
 *
 * Flow: embed the question -> find the most similar chunks (optionally scoped to one
 * document) -> stream Claude's answer grounded in those chunks via Server-Sent Events.
 *
 * SSE events emitted:
 *   `sources` once — the retrieved chunks used as context
 *   `token` many — answer text as it is generated
 *   `done` once — end of stream
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { embedQuery, streamAnswer } from '../lib/rag'
import { queryVectors } from '../lib/vectors'

export const chat = new Hono()

const DEFAULT_TOP_K = 4

chat.post('/', async (c) => {
  const { message, documentId, topK } = await c.req.json<{
    message?: string
    documentId?: string
    topK?: number
  }>()

  if (!message) {
    return c.json({ error: 'message is required' }, 400)
  }

  const queryEmbedding = await embedQuery(message)
  const matches = await queryVectors(queryEmbedding, topK ?? DEFAULT_TOP_K, documentId)

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: 'sources',
      data: JSON.stringify(matches.map((m) => ({
        documentId: m.documentId,
        filename: m.filename,
        chunkIndex: m.chunkIndex,
        distance: m.distance,
      }))),
    })

    for await (const token of streamAnswer(message, matches.map((m) => m.text))) {
      await stream.writeSSE({ event: 'token', data: token })
    }

    await stream.writeSSE({ event: 'done', data: '' })
  })
})
