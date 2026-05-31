#!/opt/homebrew/opt/node/bin/node
import * as cdk from 'aws-cdk-lib/core';
import { RagApiStack } from '../lib/infra-stack';

const app = new cdk.App();
new RagApiStack(app, 'RagApiStack', {});
