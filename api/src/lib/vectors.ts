/**
 * Thin wrapper over the Amazon S3 Vectors data-plane API.
 *
 * LangChain.js has no S3 Vectors vector-store integration yet, so we call the SDK
 * directly. Each vector's `key` is `"<documentId>#<chunkIndex>"`, and its metadata
 * carries the chunk `text` so a query can build prompt context without re-reading S3.
 */
import { PutVectorsCommand, QueryVectorsCommand, S3VectorsClient } from '@aws-sdk/client-s3vectors'
import { config } from './config'

const client = new S3VectorsClient({ region: config.region })

/** S3 Vectors caps how many vectors a single PutVectors call accepts. */
const MAX_BATCH = 200

export interface ChunkVector {
  key: string
  embedding: number[]
  metadata: {
    documentId: string
    filename: string
    chunkIndex: number
    text: string
  }
}

/** Store chunk embeddings, batched to stay within the per-call limit. */
export async function putVectors (vectors: ChunkVector[]): Promise<void> {
  for (let i = 0; i < vectors.length; i += MAX_BATCH) {
    const batch = vectors.slice(i, i + MAX_BATCH)
    await client.send(new PutVectorsCommand({
      vectorBucketName: config.vectorBucket,
      indexName: config.vectorIndex,
      vectors: batch.map((v) => ({
        key: v.key,
        data: { float32: v.embedding },
        metadata: v.metadata,
      })),
    }))
  }
}

export interface Match {
  key: string
  distance?: number
  documentId: string
  filename: string
  chunkIndex: number
  text: string
}

/**
 * Approximate-nearest-neighbour search for the chunks most similar to a query
 * embedding. Pass `documentId` to scope the search to a single document.
 */
export async function queryVectors (embedding: number[], topK: number, documentId?: string): Promise<Match[]> {
  const res = await client.send(new QueryVectorsCommand({
    vectorBucketName: config.vectorBucket,
    indexName: config.vectorIndex,
    topK,
    queryVector: { float32: embedding },
    returnMetadata: true,
    returnDistance: true,
    filter: documentId ? { documentId: { $eq: documentId } } : undefined,
  }))

  return (res.vectors ?? []).map((v) => {
    const meta = (v.metadata ?? {}) as Record<string, unknown>
    return {
      key: v.key!,
      distance: v.distance,
      documentId: String(meta.documentId ?? ''),
      filename: String(meta.filename ?? ''),
      chunkIndex: Number(meta.chunkIndex ?? 0),
      text: String(meta.text ?? ''),
    }
  })
}
