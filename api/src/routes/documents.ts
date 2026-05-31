/**
 * Document management routes: upload (presign), ingest, list, delete.
 *
 * This step implements the presign step of the upload flow:
 *   POST /documents  { filename, contentType }  ->  { documentId, key, uploadUrl }
 * The client then PUTs the file bytes directly to `uploadUrl` (an S3 presigned URL).
 */
import { Hono } from 'hono'
import { deleteDocumentObjects, findUploadedFile, getManifest, getObjectText, keys, listManifests, presignUpload, putManifest } from '../lib/s3'
import { chunkText, embedChunks } from '../lib/rag'
import { deleteVectors, putVectors } from '../lib/vectors'

export const documents = new Hono()

/** Reduce a client-supplied filename to a safe basename (no path traversal). */
function safeFilename (filename: string): string {
  return filename.split(/[\\/]/).pop()!.replace(/^\.+/, '')
}

documents.post('/', async (c) => {
  const { filename, contentType } = await c.req.json<{ filename?: string; contentType?: string }>()

  if (!filename) {
    return c.json({ error: 'filename is required' }, 400)
  }
  // This POC ingests plain text only; reject anything that isn't a text/* type.
  if (contentType && !contentType.startsWith('text/')) {
    return c.json({ error: 'only text/* content types are supported' }, 400)
  }
  const name = safeFilename(filename)
  if (!name) {
    return c.json({ error: 'filename is invalid' }, 400)
  }

  // One id per uploaded document; groups the raw file, manifest, and vector chunks.
  const documentId = crypto.randomUUID()
  const key = keys.object(documentId, name)
  const uploadUrl = await presignUpload(key, contentType ?? 'text/plain')

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
  if (embeddings.length !== chunks.length) {
    return c.json({ error: 'embedding count did not match chunk count; retry ingestion' }, 502)
  }
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

/** List every ingested document. */
documents.get('/', async (c) => {
  const manifests = await listManifests()
  return c.json({
    documents: manifests.map((m) => ({
      documentId: m.documentId,
      filename: m.filename,
      chunkCount: m.chunkCount,
      ingestedAt: m.ingestedAt,
    })),
  })
})

/**
 * Remove a document from the knowledge base: delete its vectors (via the manifest)
 * and all of its S3 objects (raw file + manifest).
 */
documents.delete('/:id', async (c) => {
  const documentId = c.req.param('id')

  const manifest = await getManifest(documentId)
  if (manifest) {
    await deleteVectors(manifest.chunkKeys)
  }
  await deleteDocumentObjects(documentId)

  return c.json({ deleted: true, documentId, chunks: manifest?.chunkCount ?? 0 })
})
