# CLAUDE.md

Context for working in this repo. For the full design narrative see
[ARCHITECTURE.md](./ARCHITECTURE.md); this file is the quick operational reference.

## What this is

A proof-of-concept **Retrieval-Augmented Generation (RAG) API** built on **Hono**,
showcasing AWS Bedrock. An authenticated user uploads text files that become a
searchable knowledge base, then asks questions via a **streaming** chat endpoint that
answers grounded in those files.

## Repo layout (pnpm workspace)

```
api/    Hono app — runs on Bun locally and AWS Lambda in prod
web/    React (Vite) frontend "Atrium" — static site behind CloudFront in prod
infra/  AWS CDK — two stacks: RagApiStack (backend) + RagWebStack (frontend hosting)
```

- `api/src/app.ts` — the Hono app (middleware + route mounting). Shared by both entries.
- `api/src/dev.ts` — Bun local entry · `api/src/index.ts` — Lambda entry (`streamHandle`).
- `api/src/routes/{documents,chat}.ts` — HTTP routes.
- `api/src/lib/{config,s3,vectors,rag}.ts` — env, S3, S3 Vectors SDK wrapper, LangChain.
- `web/src/` — React app (see `web/README.md`); `lib/api.ts` is the typed API client.
- `infra/lib/api-stack.ts` — backend (S3, S3 Vectors, Lambda, IAM, Function URL).
- `infra/lib/web-stack.ts` — frontend hosting (S3 + CloudFront/OAC + asset deploy).
- `infra/bin/infra.ts` — CDK entry: deploys `RagWebStack`, then `RagApiStack` (its CORS
  origin references the web stack's CloudFront URL — one-way, no cycle).

## Conventions (follow these)

- **Bun** for local dev/build. Do NOT introduce `tsx`, `@hono/node-server`, or
  `tsc --noEmit`. Build is `bun build`.
- **`api/src/lib/config.ts` is the only place that reads `process.env`** in the API.
  Add new settings there, not inline.
- **S3 key layout lives in `lib/s3.ts` `keys`** — never hand-build keys elsewhere.
- **S3 Vectors has no LangChain.js integration** — talk to it via `@aws-sdk/client-s3vectors`
  in `lib/vectors.ts`. LangChain is used only for chunking + Bedrock embeddings/chat.
- Each module starts with a `/** … */` doc comment explaining *why* it exists.
- Routes return JSON errors `{ error }` with appropriate status codes.

## Commands

```sh
pnpm install
pnpm dev                       # Bun server at http://localhost:3000 (loads api/.env)
pnpm build                     # bundle Lambda handler -> api/dist/index.js
pnpm --filter @rag/web dev     # Vite frontend at http://localhost:5173 (loads web/.env)
pnpm --filter @rag/web build   # build the static site -> web/dist (needed before deploy)
cd infra && npx cdk deploy --all --profile dev   # deploy both stacks (loads infra/.env)
```

**Two-stack deploy note:** the frontend bakes `VITE_API_BASE_URL` at build time, so the
first time round: deploy `--all` (frontend ships pointing at localhost), copy the
`ApiUrl` output into `web/.env`, `pnpm --filter @rag/web build`, then `cdk deploy
RagWebStack` again to re-upload `web/dist`. CDK deploys `RagWebStack` before `RagApiStack`
(the API's `CORS_ORIGINS` references the web stack's CloudFront origin).

- **`api/.env`** — local runtime config (auth, AWS_REGION, AWS_PROFILE, bucket/index
  names, model ids). Copy from `api/.env.example`.
- **`infra/.env`** — deploy-time config (auth + model ids → become Lambda env vars),
  loaded by `bin/infra.ts` via `dotenv`. Copy from `infra/.env.example`.
  `BASIC_AUTH_PASSWORD` is **required** — synth fails without it.
- AWS creds for deploy are resolved by the CDK CLI (the named profile is **`dev`**),
  NOT from `infra/.env`. Pass `--profile dev` or set `AWS_PROFILE`.

## API contract (what a frontend consumes)

Base URL = the deployed Function URL (CFN output `ApiUrl`) or `http://localhost:3000`.
All routes except `GET /health` require **HTTP Basic Auth** (`BASIC_AUTH_USERNAME` /
`BASIC_AUTH_PASSWORD`). In a browser: `Authorization: Basic base64(user:pass)`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/health` | — | `{ status: 'ok' }` (public) |
| POST | `/documents` | `{ filename, contentType }` | `{ documentId, key, uploadUrl }` |
| POST | `/documents/:id/ingest` | — | `{ documentId, filename, chunks }` |
| GET | `/documents` | — | `{ documents: [{ documentId, filename, chunkCount, ingestedAt }] }` |
| GET | `/documents/:id/download` | — | `{ url, filename }` (presigned GET, 5-min TTL) |
| DELETE | `/documents/:id` | — | `{ deleted, documentId, chunks }` |
| POST | `/chat` | `{ message, documentId?, topK? }` | SSE stream (see below) |

**Upload flow (3 steps):**
1. `POST /documents` → returns a presigned `uploadUrl`.
2. `PUT` the file bytes directly to `uploadUrl` with the **same `Content-Type`** you
   sent in step 1 (it's part of the signature). Only `text/*` types are accepted.
3. `POST /documents/:id/ingest` to chunk/embed/store.

The docs S3 bucket has permissive **CORS (PUT/GET, all origins)** so a browser can do
the presigned PUT directly.

**`/chat` SSE events** (the response is `text/event-stream`):
- `event: sources` — once, `data` = JSON array of `{ documentId, filename, chunkIndex, distance }`
- `event: token` — many, `data` = a piece of the answer text (concatenate them).
  Note: a token containing a newline is split across multiple `data:` lines per the SSE
  spec; the browser `EventSource`/parser rejoins them.
- `event: done` — once, end of stream.

`documentId` scopes retrieval to one document; a scoped query that matches nothing
returns **404** (not an empty stream). Omit it to search all documents.

Examples for every endpoint are in [`api/src/requests.http`](./api/src/requests.http).

## Models & infra notes (gotchas)

- **Embeddings**: `amazon.titan-embed-text-v2:0` (1024-dim, cosine). Index dimension is
  fixed at 1024 in the CDK stack — changing the embedding model means recreating the index.
- **Chat**: `us.anthropic.claude-haiku-4-5-20251001-v1:0`. Must use the **`us.`
  cross-region inference profile** id — the bare foundation-model id is rejected for
  on-demand invocation. Lambda IAM grants the profile ARN + the underlying
  foundation-model ARNs in us-east-1/us-east-2/us-west-2.
- **Bedrock model access** must be enabled in the account/region (Bedrock console →
  Model access) for both models, or calls fail at runtime.
- **Streaming on Lambda** needs `streamHandle` (in `index.ts`) + Function URL
  `InvokeMode: RESPONSE_STREAM` (set in the stack). Don't switch back to `handle`.
- **Region**: `us-east-1` (both Bedrock and S3 Vectors available).
- After a deploy that changes Lambda env vars, warm containers with the old env can
  serve a few requests for ~minutes → transient `401`s. Not a code bug; it drains.
- Ingestion is **synchronous** in the ingest route (fine for small POC files; the
  Lambda timeout is 120s). For large docs, move to an async S3-event Lambda.
- The deployed stack can lag local code — redeploy after changes:
  `cd infra && npx cdk deploy --profile dev`.

## Tooling quirks

- This developer's local shell is **zsh**; shell functions invoked via `$( )` can lose
  PATH under sandboxing. Prefer linear scripts / top-level loops for ad-hoc testing, or
  test routes in-process with Hono's `app.request(...)` (no server/port needed).

## Ideas / next steps

- A small **frontend** consuming the SSE `/chat` (use the browser `fetch` +
  `ReadableStream`, or `EventSource` via a GET variant) and the 3-step upload flow.
- Async ingestion via S3 event notifications.
- Move the basic-auth secret to AWS Secrets Manager instead of a plain Lambda env var.
