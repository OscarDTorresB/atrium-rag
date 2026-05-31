/**
 * Typed client for the RAG API.
 *
 * One place that knows how to talk to the backend: it attaches Basic Auth, runs the
 * three-step upload flow (presign → PUT to S3 → ingest), lists/deletes documents, and
 * streams the chat answer by parsing the SSE response by hand (the backend streams over
 * POST, which the browser `EventSource` cannot do).
 *
 * Nothing here leaks the retrieval/RAG mechanics to the UI — `sources` events are
 * silently dropped so the demo stays focused on the conversation.
 */
import { basicAuthHeader, type Credentials, getCredentials } from './auth'

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')

export class AuthError extends Error {}

export type DocumentSummary = {
  documentId: string
  filename: string
  chunkCount: number
  ingestedAt: string
}

/** Wrap fetch with the stored Basic Auth header and uniform 401 handling. */
async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const creds = getCredentials()
  if (!creds) throw new AuthError('not signed in')
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: basicAuthHeader(creds) },
  })
  if (res.status === 401) throw new AuthError('invalid credentials')
  return res
}

/** Verify credentials by hitting an authed endpoint; used by the sign-in screen. */
export async function verifyCredentials(creds: Credentials): Promise<boolean> {
  const res = await fetch(`${API_BASE}/documents`, {
    headers: { Authorization: basicAuthHeader(creds) },
  })
  if (res.status === 401) return false
  if (!res.ok) throw new Error(`unexpected status ${res.status}`)
  return true
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const res = await authed('/documents')
  if (!res.ok) throw new Error(`failed to load library (${res.status})`)
  const data = (await res.json()) as { documents: DocumentSummary[] }
  return data.documents
}

export async function deleteDocument(documentId: string): Promise<void> {
  const res = await authed(`/documents/${documentId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`failed to remove file (${res.status})`)
}

/** Get a short-lived URL to view/download a document's original file. */
export async function getDownloadUrl(documentId: string): Promise<string> {
  const res = await authed(`/documents/${documentId}/download`)
  if (!res.ok) throw new Error(`failed to open file (${res.status})`)
  const { url } = (await res.json()) as { url: string }
  return url
}

/**
 * Run the full add-to-library flow for a single file and resolve once it is searchable.
 * `onPhase` reports progress so the UI can show a friendly, non-technical status.
 */
export async function addFile(
  file: File,
  onPhase?: (phase: 'uploading' | 'processing') => void,
): Promise<void> {
  // The presign signature is tied to the content type, and the API only accepts text/*.
  const contentType = file.type && file.type.startsWith('text/') ? file.type : 'text/plain'

  onPhase?.('uploading')
  const presignRes = await authed('/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, contentType }),
  })
  if (!presignRes.ok) throw new Error(`could not start upload (${presignRes.status})`)
  const { documentId, uploadUrl } = (await presignRes.json()) as { documentId: string; uploadUrl: string }

  // PUT the bytes straight to S3 — no Authorization header, the URL is presigned.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  })
  if (!putRes.ok) throw new Error(`upload failed (${putRes.status})`)

  onPhase?.('processing')
  const ingestRes = await authed(`/documents/${documentId}/ingest`, { method: 'POST' })
  if (!ingestRes.ok) throw new Error(`could not process file (${ingestRes.status})`)
}

/**
 * Stream a chat answer. Calls `onToken` with each piece of text as it arrives and
 * resolves when the stream is done. Pass an `AbortSignal` to cancel mid-answer.
 */
export async function streamChat(
  message: string,
  onToken: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const creds = getCredentials()
  if (!creds) throw new AuthError('not signed in')

  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: basicAuthHeader(creds) },
    body: JSON.stringify({ message }),
    signal,
  })
  if (res.status === 401) throw new AuthError('invalid credentials')
  if (res.status === 404) throw new Error('There is nothing in your library to answer from yet.')
  if (!res.ok || !res.body) throw new Error(`chat failed (${res.status})`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  // Parse SSE frames: events are separated by a blank line; within a frame, `event:` and
  // (possibly multiple) `data:` lines. Multiple data lines rejoin with "\n" per the spec,
  // which is how a token containing a newline arrives.
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)

      let event = 'message'
      const dataLines: string[] = []
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
      }
      const data = dataLines.join('\n')

      if (event === 'token') onToken(data)
      else if (event === 'done') return
      // `sources` (and anything else) is intentionally ignored — kept out of the UI.
    }
  }
}
