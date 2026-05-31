#!/opt/homebrew/opt/node/bin/node
// Load infra/.env first so the stack's deploy-time env vars (auth, model ids) are
// available when ../lib/infra-stack is evaluated. dotenv does not override vars
// already set in the shell, so CI (which exports real values) is unaffected.
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib/core';
import { RagApiStack } from '../lib/infra-stack';

const app = new cdk.App();
new RagApiStack(app, 'RagApiStack', {});
