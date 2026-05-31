# Architecture — RAG API (Hono + AWS Bedrock + S3 Vectors)

A proof-of-concept Retrieval-Augmented Generation (RAG) API. An authenticated user
uploads text documents; the API turns them into a searchable knowledge base, and a
streaming chat endpoint answers questions grounded in those documents.

The point of this POC is to learn how the pieces fit together, so this document
explains not just *what* the system does but *why* each part exists.

---

## 1. What is RAG, briefly

A large language model (LLM) only knows what it was trained on. **RAG** lets it answer
questions about *your* data without retraining, by doing two things at query time:

1. **Retrieve** — find the chunks of your documents most relevant to the question.
2. **Augment + Generate** — paste those chunks into the prompt as context, then ask
   the LLM to answer using them.

The "find most relevant chunks" step is **semantic search**: we convert text into
**embeddings** (lists of numbers that capture meaning) and find the chunks whose
embeddings are closest to the question's embedding. Those embeddings live in a
**vector store**.

---

## 2. The big picture

```
                         ┌──────────────────────────────────────────────┐
                         │                  Hono API                     │
                         │            (AWS Lambda + Function URL)         │
   client ──basic auth──▶│                                                │
                         │  /documents      presign · ingest · list · del │
                         │  /chat           streaming RAG query           │
                         └───────┬───────────────┬───────────────┬────────┘
                                 │               │               │
                    presigned PUT│        embed/generate         │vectors
                                 ▼               ▼               ▼
                         ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                         │  S3 (docs)   │ │ Bedrock      │ │ S3 Vectors   │
                         │ raw files +  │ │ Titan embed  │ │ index of     │
                         │ manifests    │ │ Claude chat  │ │ chunk vectors│
                         └──────────────┘ └──────────────┘ └──────────────┘
```

### Components

| Component | Role | Why this choice |
|---|---|---|
| **Hono** | HTTP framework; runs the same code on Bun locally and Lambda in prod | Tiny, fast, Web-standard `Request`/`Response`, first-class streaming |
| **AWS Lambda + Function URL** | Serverless host for the API | No servers to manage; Function URLs support response streaming |
| **S3 (documents bucket)** | Stores raw uploaded files + per-document manifests | Cheap durable object storage; presigned URLs let clients upload directly |
| **Amazon Bedrock — Titan Embeddings v2** | Turns text into 1024-dim embeddings | Managed embeddings, no model hosting |
| **Amazon Bedrock — Claude 3.5 Haiku** | Generates the final answer from question + context | Managed LLM; Haiku is fast/cheap for a POC |
| **S3 Vectors** | Stores + similarity-searches chunk embeddings | AWS-native vector store, serverless, very cheap vs. OpenSearch/Aurora |
| **LangChain.js** | Text splitting + Bedrock embedding/chat clients | Saves us from hand-rolling chunking and Bedrock request plumbing |
| **AWS CDK** | Provisions all infrastructure as code | One-command, reproducible deploys |

> **Note on LangChain + S3 Vectors:** LangChain.js does **not** yet ship an S3 Vectors
> vector-store integration (only the Python package does). So we use LangChain.js for
> chunking, embeddings, and the chat model, and talk to S3 Vectors directly through the
> official `@aws-sdk/client-s3vectors` SDK, wrapped in our own small `lib/vectors.ts`.

---

## 3. The two main flows

### 3.1 Ingestion — turning a file into searchable knowledge

```
1. POST /documents            client asks for a place to upload
   { filename, contentType }
        │
        ▼  API returns a presigned S3 PUT URL + a generated documentId
   { documentId, key, uploadUrl }
        │
2. PUT <uploadUrl>            client uploads the file bytes straight to S3
        │                     (bypasses Lambda's ~6MB payload limit)
        ▼
3. POST /documents/:id/ingest  client tells the API "the file is uploaded, process it"
        │
        ├─ a. fetch the object from S3
        ├─ b. split text into overlapping chunks   (LangChain RecursiveCharacterTextSplitter)
        ├─ c. embed each chunk                      (Bedrock Titan → 1024 floats)
        ├─ d. PutVectors into S3 Vectors            (key = "<documentId>#<chunkIndex>",
        │                                            metadata = { documentId, filename, text })
        └─ e. write a manifest.json to S3           (lists every chunk key for later deletion)
```

**Why presigned URLs?** A Lambda behind a Function URL can only receive ~6MB request
bodies. Presigned PUT URLs let the client upload arbitrarily large files directly to S3;
the API only ever handles small JSON.

**Why a manifest?** S3 Vectors' `DeleteVectors` needs the explicit keys to delete (there
is no "delete by prefix"). When we ingest, we record every chunk key in
`docs/<documentId>/manifest.json` so delete is a simple read-then-delete.

### 3.2 Query — answering a question with RAG (streaming)

```
POST /chat  { message, documentId? }
        │
        ├─ a. embed the question                    (Bedrock Titan)
        ├─ b. QueryVectors topK                      (S3 Vectors; optional filter to one documentId)
        ├─ c. build a context block from the         (the retrieved chunk texts come back
        │     retrieved chunks' text                  in vector metadata — no second S3 read)
        ├─ d. prompt Claude with context + question  (ChatBedrockConverse)
        └─ e. stream the answer token-by-token       (Hono streaming → SSE to the client)
```

**Why streaming?** It's a great Hono showcase and makes the demo feel responsive — the
user sees the answer appear as it's generated rather than waiting for the whole thing.
On Lambda this requires the Function URL `InvokeMode` to be `RESPONSE_STREAM`.

---

## 4. Data model

### S3 documents bucket layout
```
docs/<documentId>/<originalFilename>     the raw uploaded file
docs/<documentId>/manifest.json          { documentId, filename, contentType,
                                            chunkKeys: [...], ingestedAt }
```

### S3 Vectors index
- **One index**, dimension **1024** (Titan v2), distance metric **cosine**.
- **Vector key:** `<documentId>#<chunkIndex>` — deterministic, groups chunks by document.
- **Metadata per vector:** `{ documentId, filename, chunkIndex, text }`.
  Storing the chunk `text` in metadata means a query can build its context block from the
  query response alone, with no extra lookups.

---

## 5. Security & configuration

- **Auth:** HTTP Basic Auth on every route except `/health`. Credentials come from
  environment variables (`BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`) — never hardcoded.
- **IAM (Lambda execution role):** least-privilege access to exactly the docs bucket
  (`s3:GetObject/PutObject/DeleteObject/ListBucket`), the vector index
  (`s3vectors:PutVectors/QueryVectors/DeleteVectors`), and the two Bedrock models
  (`bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`).
- **Config** is centralized in `api/src/lib/config.ts` and surfaced via Lambda env vars
  set by CDK (bucket names, index name, model IDs, region).

---

## 6. Local development vs. production

The same Hono `app` runs in both places — only the *entry point* differs:

| | Local | Production |
|---|---|---|
| Entry | `api/src/dev.ts` (Bun server) | `api/src/index.ts` (Lambda handler) |
| Run | `pnpm dev` (hot reload) | `cdk deploy` bundles with Bun |
| AWS calls | hit **real** AWS (Bedrock/S3/S3 Vectors) using your local credentials | use the Lambda execution role |
| Streaming | native (Bun) | `streamHandle` + Function URL `RESPONSE_STREAM` |

This "write once, run in both" property is a core reason for choosing Hono.

---

## 7. Source layout (target)

```
api/src/
  app.ts              Hono app: middleware + route wiring
  index.ts            Lambda entry (streaming handler)
  dev.ts              Bun local entry
  lib/
    config.ts         env parsing (one typed config object)
    s3.ts             S3 client: presign, get, delete, list
    vectors.ts        S3 Vectors wrapper: put / query / delete
    rag.ts            chunking + Titan embeddings + Claude chat
  routes/
    documents.ts      presign · ingest · list · delete
    chat.ts           streaming RAG query

infra/lib/
  infra-stack.ts      S3 bucket, S3 Vectors bucket/index, Lambda, IAM, Function URL
```

---

## 8. Build order (incremental, each step testable)

1. **Architecture docs** — this file.
2. **Config + env auth** — `lib/config.ts`, basic auth from env.
3. **Infra** — docs bucket + S3 Vectors index + Lambda wiring.
4. **Presign upload** — `lib/s3.ts`, `POST /documents`.
5. **Ingest** — `lib/vectors.ts`, `lib/rag.ts`, `POST /documents/:id/ingest`.
6. **Streaming chat** — `POST /chat`.
7. **List + delete** — `GET /documents`, `DELETE /documents/:id`.
8. **Lambda streaming + deploy** — end-to-end on AWS.

Each step is documented as it lands.
