/**
 * Streaming RAG chat:
 *   POST /chat { message, documentId?, topK? }
 *
 * Flow: embed the question -> find the most similar chunks (optionally scoped to one
 * document) -> stream Claude's answer grounded in those chunks via Server-Sent Events.
 *
 * SSE events emitted:
 *   `token` many — answer text as it is generated (streamed first)
 *   `sources` at most once, after the tokens — only the chunks the answer actually cited
 *     via `[n]` markers, each tagged with its `cite` number; omitted if nothing was cited
 *   `done` once — end of stream
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { embedQuery, parseCitations, streamAnswer } from '../lib/rag'
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

  // A scoped query that finds nothing means the document doesn't exist / isn't ingested.
  if (matches.length === 0 && documentId) {
    return c.json({ error: 'no ingested content found for that documentId' }, 404)
  }

  return streamSSE(c, async (stream) => {
    let answer = ''
    for await (const token of streamAnswer(message, matches.map((m) => m.text))) {
      answer += token
      await stream.writeSSE({ event: 'token', data: token })
    }

    // Surface only the chunks the answer cited (`[n]` → the n-th retrieved chunk), each
    // tagged with its `cite` number so the UI can tie a footnote back to its document.
    const cited = parseCitations(answer, matches.length)
    if (cited.length) {
      await stream.writeSSE({
        event: 'sources',
        data: JSON.stringify(cited.map((n) => {
          const m = matches[n - 1]
          return {
            cite: n,
            documentId: m.documentId,
            filename: m.filename,
            chunkIndex: m.chunkIndex,
            distance: m.distance,
          }
        })),
      })
    }

    await stream.writeSSE({ event: 'done', data: '' })
  })
})
