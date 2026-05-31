# rag-api

A Hono-based Retrieval-Augmented Generation (RAG) API on AWS. An authenticated user
uploads text documents that become a searchable knowledge base, then asks questions via
a streaming chat endpoint grounded in those documents. Monorepo managed with pnpm
workspaces. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## Stack

- **Runtime**: [Bun](https://bun.sh) (local dev + build)
- **Framework**: [Hono](https://hono.dev) — same app runs locally (Bun) and on Lambda
- **RAG**: [LangChain.js](https://js.langchain.com) (chunking + Bedrock clients)
- **Models**: Amazon Bedrock — Titan Embeddings v2 + Claude Haiku 4.5
- **Vector store**: [Amazon S3 Vectors](https://aws.amazon.com/s3/features/vectors/)
- **Storage**: Amazon S3 (raw files + per-document manifests)
- **Infra**: AWS Lambda + Function URL (streaming), provisioned with [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- **CI/CD**: GitHub Actions — deploys on push to `main`

## API

All routes require HTTP Basic Auth except `GET /health`.

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Liveness check (public) |
| `POST` | `/documents` | `{ filename, contentType }` | Returns `{ documentId, key, uploadUrl }` (presigned S3 PUT) |
| `POST` | `/documents/:id/ingest` | — | Chunk → embed → store vectors for an uploaded file |
| `GET` | `/documents` | — | List ingested documents |
| `DELETE` | `/documents/:id` | — | Remove a document's vectors + S3 objects |
| `POST` | `/chat` | `{ message, documentId?, topK? }` | Streamed (SSE) answer grounded in retrieved chunks |

Upload flow: `POST /documents` → `PUT` the bytes to `uploadUrl` → `POST /documents/:id/ingest`.
See [`api/src/requests.http`](./api/src/requests.http) for runnable examples.

### Configuration (env)

| Var | Purpose |
|-----|---------|
| `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD` | Credentials for all non-health routes |
| `AWS_REGION` / `AWS_PROFILE` | Region + local credentials profile |
| `DOCS_BUCKET_NAME` / `VECTOR_BUCKET_NAME` / `VECTOR_INDEX_NAME` | From CDK stack outputs |
| `EMBEDDING_MODEL_ID` | Default `amazon.titan-embed-text-v2:0` |
| `CHAT_MODEL_ID` | Default `us.anthropic.claude-haiku-4-5-20251001-v1:0` (inference profile) |

> **Bedrock model access** must be enabled (Bedrock console → Model access) for the
> embedding and chat models. Claude Haiku 4.5 requires the `us.` cross-region inference
> profile id — the bare foundation-model id is rejected for on-demand invocation.

## Getting started

```sh
pnpm install
```

Copy the env template and fill in any values from your deployed stack:

```sh
cp api/.env.example api/.env
```

## Development

Start the local Bun server with hot reload:

```sh
pnpm dev
```

Server runs at `http://localhost:3000`. Bun auto-loads `api/.env`.

## Build

Bundle the Lambda handler with Bun:

```sh
pnpm build
# output: api/dist/index.js
```

## Deploy

Deploy-time settings (auth credentials, model ids) live in `infra/.env`, loaded by the
CDK app via `dotenv`. Copy the template once and fill it in:

```sh
cp infra/.env.example infra/.env   # set BASIC_AUTH_PASSWORD at minimum
```

AWS credentials/region for the deploy itself are resolved by the CDK CLI, not `.env` —
pass a named profile (or set `AWS_PROFILE`):

```sh
pnpm --filter @rag/infra exec npx cdk deploy --profile dev
```

The API URL is printed as a stack output (`ApiUrl`) after a successful deploy. The
`pnpm deploy` script runs the same command without the profile flag (use it when AWS
creds are already in your environment, e.g. CI).

> First-time deploy requires a bootstrapped CDK environment:
> ```sh
> pnpm --filter @rag/infra exec npx cdk bootstrap --profile dev
> ```

## CI/CD

GitHub Actions deploys automatically on push to `main`. Add these secrets to your repo:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key with deploy permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | Target region (e.g. `us-east-1`) |
