# @rag/web — Atrium

A small React (Vite) chat app for the RAG POC: sign in, build a library of text
documents, and chat with answers grounded in them. The retrieval mechanics are
intentionally invisible — it's just an upload panel and a conversation.

## Run locally

```sh
pnpm install                       # from the repo root (workspace install)
cp web/.env.example web/.env       # set VITE_API_BASE_URL (defaults to localhost:3000)
pnpm --filter @rag/web dev         # Vite dev server at http://localhost:5173
```

The API must be running and reachable (`pnpm dev` for the local Bun server, or point
`VITE_API_BASE_URL` at the deployed Function URL). Sign in with the API's
`BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD`.

> The API needs CORS to allow this origin. `CORS_ORIGINS` defaults to `*`; set it to a
> specific origin list to lock it down.

## Build

```sh
pnpm --filter @rag/web build       # type-checks, then outputs static assets to web/dist
```

`base: './'` keeps asset paths relative, so `dist/` can be served from any static host
(e.g. S3 + CloudFront).

## How it maps to the API

- **Sign in** validates credentials with `GET /documents`, then keeps them in
  `sessionStorage` and sends `Authorization: Basic …` on every call.
- **Add a document** runs the three-step flow: `POST /documents` → presigned `PUT` to
  S3 → `POST /documents/:id/ingest`, surfaced as *Uploading… → Reading… → Ready*.
- **Chat** POSTs to `/chat` and parses the SSE stream by hand (`fetch` + `ReadableStream`,
  since `EventSource` can't POST). `token` events stream into the reply; `sources` is
  ignored so nothing technical leaks into the UI.

See `src/lib/api.ts` for the typed client and `../CLAUDE.md` for the full API contract.
