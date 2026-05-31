/**
 * Centralized, typed configuration.
 *
 * Every value the app needs from the environment is read here exactly once, so the
 * rest of the code depends on a single typed object instead of scattered `process.env`
 * lookups. In production these come from Lambda env vars (set by CDK); locally they
 * come from `api/.env` (auto-loaded by Bun).
 */

function required (name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function optional (name: string, fallback: string): string {
  return process.env[name] ?? fallback
}

export const config = {
  /** AWS region for all SDK clients (S3, S3 Vectors, Bedrock). */
  region: optional('AWS_REGION', 'us-east-1'),

  /** HTTP Basic Auth credentials guarding every route except /health. */
  auth: {
    username: required('BASIC_AUTH_USERNAME'),
    password: required('BASIC_AUTH_PASSWORD'),
  },

  /** S3 bucket holding raw uploaded files + per-document manifests. */
  docsBucket: required('DOCS_BUCKET_NAME'),

  /** S3 Vectors bucket + index storing chunk embeddings. */
  vectorBucket: required('VECTOR_BUCKET_NAME'),
  vectorIndex: required('VECTOR_INDEX_NAME'),

  /**
   * Bedrock model IDs for embeddings (Titan) and chat generation (Claude).
   * The chat default is the `us.` cross-region inference profile — Claude Haiku 4.5
   * rejects on-demand invocation by its bare foundation-model id.
   */
  embeddingModelId: optional('EMBEDDING_MODEL_ID', 'amazon.titan-embed-text-v2:0'),
  chatModelId: optional('CHAT_MODEL_ID', 'us.anthropic.claude-haiku-4-5-20251001-v1:0'),
}
