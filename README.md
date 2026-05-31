# rag-api

A Hono-based REST API deployed to AWS Lambda via CDK. Monorepo managed with pnpm workspaces.

## Stack

- **Runtime**: [Bun](https://bun.sh) (local dev + build)
- **Framework**: [Hono](https://hono.dev)
- **Infra**: AWS Lambda + Function URL, provisioned with [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html)
- **CI/CD**: GitHub Actions — deploys on push to `main`

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

CDK provisions and updates the Lambda + Function URL in one command:

```sh
pnpm deploy
```

The API URL is printed as a stack output (`ApiUrl`) after a successful deploy.

> First-time deploy requires a bootstrapped CDK environment:
> ```sh
> pnpm --filter @rag/infra exec npx cdk bootstrap
> ```

## CI/CD

GitHub Actions deploys automatically on push to `main`. Add these secrets to your repo:

| Secret | Description |
|--------|-------------|
| `AWS_ACCESS_KEY_ID` | AWS access key with deploy permissions |
| `AWS_SECRET_ACCESS_KEY` | Corresponding secret key |
| `AWS_REGION` | Target region (e.g. `us-east-1`) |
