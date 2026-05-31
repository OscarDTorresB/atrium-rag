#!/opt/homebrew/opt/node/bin/node
// Load infra/.env first so the stacks' deploy-time env vars (auth, model ids) are
// available when ../lib/* are evaluated. dotenv does not override vars already set in
// the shell, so CI (which exports real values) is unaffected.
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib/core';
import { RagWebStack } from '../lib/web-stack';
import { RagApiStack } from '../lib/api-stack';

const app = new cdk.App();

// Web first: it owns the CloudFront origin the API trusts for CORS. The API stack
// references that origin, so CDK deploys RagWebStack before RagApiStack. There is no
// cycle — the frontend gets the API URL at build time, not from a stack reference.
const web = new RagWebStack(app, 'RagWebStack', {});
new RagApiStack(app, 'RagApiStack', { webOrigin: web.distributionUrl });
