/**
 * Document management routes: upload (presign), ingest, list, delete.
 *
 * This step implements the presign step of the upload flow:
 *   POST /documents  { filename, contentType }  ->  { documentId, key, uploadUrl }
 * The client then PUTs the file bytes directly to `uploadUrl` (an S3 presigned URL).
 */
import { Hono } from 'hono'
import { findUploadedFile, getObjectText, keys, presignUpload, putManifest } from '../lib/s3'
import { chunkText, embedChunks } from '../lib/rag'
import { putVectors } from '../lib/vectors'

export const documents = new Hono()

documents.post('/', async (c) => {
  const { filename, contentType } = await c.req.json<{ filename?: string; contentType?: string }>()

  if (!filename) {
    return c.json({ error: 'filename is required' }, 400)
  }

  // One id per uploaded document; groups the raw file, manifest, and vector chunks.
  const documentId = crypto.randomUUID()
  const key = keys.object(documentId, filename)
  const uploadUrl = await presignUpload(key, contentType ?? 'application/octet-stream')

  return c.json({ documentId, key, uploadUrl })
})

/**
 * Ingest an already-uploaded document into the knowledge base:
 *   fetch from S3 -> chunk -> embed (Titan) -> store vectors -> write manifest.
 */
documents.post('/:id/ingest', async (c) => {
  const documentId = c.req.param('id')

  const file = await findUploadedFile(documentId)
  if (!file) {
    return c.json({ error: 'no uploaded file found for this document' }, 404)
  }

  const text = await getObjectText(file.key)
  const chunks = await chunkText(text)
  if (chunks.length === 0) {
    return c.json({ error: 'file has no extractable text' }, 400)
  }

  const embeddings = await embedChunks(chunks)
  const vectors = chunks.map((chunk, chunkIndex) => ({
    key: `${documentId}#${chunkIndex}`,
    embedding: embeddings[chunkIndex],
    metadata: { documentId, filename: file.filename, chunkIndex, text: chunk },
  }))

  await putVectors(vectors)
  await putManifest(documentId, {
    documentId,
    filename: file.filename,
    chunkKeys: vectors.map((v) => v.key),
    chunkCount: vectors.length,
    ingestedAt: new Date().toISOString(),
  })

  return c.json({ documentId, filename: file.filename, chunks: vectors.length })
})
