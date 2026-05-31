/**
 * S3 access for the documents bucket.
 *
 * Holds the raw uploaded files and a per-document `manifest.json`. Uploads use
 * presigned PUT URLs so clients send bytes straight to S3, bypassing Lambda's
 * ~6MB request-body limit.
 */
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config'

const s3 = new S3Client({ region: config.region })

/** Presigned URLs expire after 5 minutes — long enough to start an upload. */
const PRESIGN_TTL_SECONDS = 300

/** S3 key layout, kept in one place so every module agrees on it. */
export const keys = {
  /** The raw uploaded file. */
  object: (documentId: string, filename: string) => `docs/${documentId}/${filename}`,
  /** Prefix for everything belonging to a document. */
  prefix: (documentId: string) => `docs/${documentId}/`,
  /** Sidecar listing the document's vector chunk keys (used for deletion). */
  manifest: (documentId: string) => `docs/${documentId}/manifest.json`,
}

/** What we record about a document after ingestion. */
export interface Manifest {
  documentId: string
  filename: string
  chunkKeys: string[]
  chunkCount: number
  ingestedAt: string
}

/**
 * Create a presigned PUT URL the client uses to upload a file directly to S3.
 * The client must send the same `Content-Type` it was signed with.
 */
export async function presignUpload(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.docsBucket,
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS })
}

/**
 * Create a presigned GET URL so the client can view/download the raw file directly
 * from S3. `filename` sets the download name via Content-Disposition (inline, so text
 * still renders in the browser tab rather than forcing a save).
 */
export async function presignDownload(key: string, filename: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: config.docsBucket,
    Key: key,
    ResponseContentDisposition: `inline; filename="${filename.replace(/"/g, '')}"`,
  })
  return getSignedUrl(s3, command, { expiresIn: PRESIGN_TTL_SECONDS })
}

/**
 * Locate the uploaded source file for a document. We only stored one file plus a
 * manifest under the prefix, so return the first object that isn't the manifest.
 */
export async function findUploadedFile(documentId: string): Promise<{ key: string; filename: string } | null> {
  const prefix = keys.prefix(documentId)
  const res = await s3.send(new ListObjectsV2Command({ Bucket: config.docsBucket, Prefix: prefix }))
  const manifestKey = keys.manifest(documentId)
  const object = res.Contents?.find((o) => o.Key && o.Key !== manifestKey)
  if (!object?.Key) return null
  return { key: object.Key, filename: object.Key.slice(prefix.length) }
}

/** Read an object's body as a UTF-8 string. */
export async function getObjectText(key: string): Promise<string> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.docsBucket, Key: key }))
  if (!res.Body) throw new Error(`S3 object ${key} returned an empty body`)
  return res.Body.transformToString('utf-8')
}

/** Write the per-document manifest. */
export async function putManifest(documentId: string, manifest: Manifest): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: config.docsBucket,
    Key: keys.manifest(documentId),
    ContentType: 'application/json',
    Body: JSON.stringify(manifest),
  }))
}

/** Read a document's manifest, or null if it hasn't been ingested. */
export async function getManifest(documentId: string): Promise<Manifest | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: config.docsBucket, Key: keys.manifest(documentId) }))
    if (!res.Body) throw new Error(`manifest for ${documentId} returned an empty body`)
    return JSON.parse(await res.Body.transformToString('utf-8')) as Manifest
  } catch (err) {
    if (err instanceof Error && err.name === 'NoSuchKey') return null
    throw err
  }
}

/** List every ingested document by reading its manifest. */
export async function listManifests(): Promise<Manifest[]> {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: config.docsBucket, Prefix: 'docs/' }))
  const manifestKeys = res.Contents?.filter((o) => o.Key?.endsWith('/manifest.json')) ?? []
  return Promise.all(manifestKeys.map(async (o) => {
    const obj = await s3.send(new GetObjectCommand({ Bucket: config.docsBucket, Key: o.Key! }))
    return JSON.parse(await obj.Body!.transformToString('utf-8')) as Manifest
  }))
}

/** Delete every S3 object belonging to a document (raw file + manifest). */
export async function deleteDocumentObjects(documentId: string): Promise<void> {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: config.docsBucket, Prefix: keys.prefix(documentId) }))
  const objects = res.Contents?.map((o) => ({ Key: o.Key! })) ?? []
  if (objects.length === 0) return
  await s3.send(new DeleteObjectsCommand({ Bucket: config.docsBucket, Delete: { Objects: objects } }))
}
