import { aws_lambda, CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Bucket, HttpMethods } from 'aws-cdk-lib/aws-s3';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs'

/**
 * Models used by the RAG pipeline. Overridable via deploy-time env vars so you can
 * swap to a cheaper/larger model without touching code.
 */
const EMBEDDING_MODEL_ID = process.env.EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0'
// Claude Haiku 4.5 must be invoked through its cross-region inference profile (us.*),
// not the bare foundation-model id (on-demand throughput is unsupported for the bare id).
const CHAT_MODEL_ID = process.env.CHAT_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
const EMBEDDING_DIMENSION = 1024 // Titan Embeddings v2 default
// Regions a "us." system-defined inference profile can route requests to.
const INFERENCE_PROFILE_REGIONS = ['us-east-1', 'us-east-2', 'us-west-2']

export class RagApiStack extends Stack {
  constructor (scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    // ---------------------------------------------------------------------------
    // 1. Documents bucket — stores raw uploads + per-document manifests.
    //    CORS lets a browser PUT directly to S3 via the presigned URL.
    // ---------------------------------------------------------------------------
    const docsBucket = new Bucket(this, 'DocsBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // POC: tear down cleanly
      autoDeleteObjects: true,
      cors: [{
        allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
    })

    // ---------------------------------------------------------------------------
    // 2. S3 Vectors bucket + index — the vector store for chunk embeddings.
    //    No CDK L2 construct exists yet, so we create them with AwsCustomResource
    //    calls to the s3vectors control-plane API. installLatestAwsSdk ensures the
    //    custom-resource Lambda has a new-enough SDK to know the s3vectors client.
    // ---------------------------------------------------------------------------
    const vectorBucketName = `${this.stackName.toLowerCase()}-vectors`
    const vectorIndexName = 'documents'

    const s3VectorsPolicy = AwsCustomResourcePolicy.fromStatements([
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3vectors:CreateVectorBucket', 's3vectors:DeleteVectorBucket'],
        resources: ['*'],
      }),
    ])

    const vectorBucket = new AwsCustomResource(this, 'VectorBucket', {
      installLatestAwsSdk: true,
      policy: s3VectorsPolicy,
      onCreate: {
        service: '@aws-sdk/client-s3vectors',
        action: 'CreateVectorBucket',
        parameters: { vectorBucketName },
        physicalResourceId: PhysicalResourceId.of(vectorBucketName),
      },
      onDelete: {
        service: '@aws-sdk/client-s3vectors',
        action: 'DeleteVectorBucket',
        parameters: { vectorBucketName },
      },
    })

    const vectorIndex = new AwsCustomResource(this, 'VectorIndex', {
      installLatestAwsSdk: true,
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3vectors:CreateIndex', 's3vectors:DeleteIndex'],
          resources: ['*'],
        }),
      ]),
      onCreate: {
        service: '@aws-sdk/client-s3vectors',
        action: 'CreateIndex',
        parameters: {
          vectorBucketName,
          indexName: vectorIndexName,
          dataType: 'float32',
          dimension: EMBEDDING_DIMENSION,
          distanceMetric: 'cosine',
          // `text` holds the full chunk (large) — keep it out of the filterable set.
          // documentId/filename/chunkIndex stay filterable so /chat can scope to a doc.
          metadataConfiguration: { nonFilterableMetadataKeys: ['text'] },
        },
        physicalResourceId: PhysicalResourceId.of(`${vectorBucketName}/${vectorIndexName}`),
      },
      onDelete: {
        service: '@aws-sdk/client-s3vectors',
        action: 'DeleteIndex',
        parameters: { vectorBucketName, indexName: vectorIndexName },
      },
    })
    // The index lives inside the bucket — enforce ordering on both create and delete.
    vectorIndex.node.addDependency(vectorBucket)

    // ---------------------------------------------------------------------------
    // 3. API Lambda — the Hono app. Env vars wire it to the resources above.
    //    (AWS_REGION is injected by Lambda automatically, so we don't set it.)
    // ---------------------------------------------------------------------------
    const honoLambda = new NodejsFunction(this, 'ApiFunction', {
      entry: '../api/src/index.ts',
      handler: 'handler',
      runtime: aws_lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.seconds(30),
      // Bundle everything (incl. the very new @aws-sdk/client-s3vectors) rather than
      // relying on the runtime's bundled SDK, which may not include it yet.
      bundling: { externalModules: [] },
      environment: {
        DOCS_BUCKET_NAME: docsBucket.bucketName,
        VECTOR_BUCKET_NAME: vectorBucketName,
        VECTOR_INDEX_NAME: vectorIndexName,
        EMBEDDING_MODEL_ID,
        CHAT_MODEL_ID,
        BASIC_AUTH_USERNAME: process.env.BASIC_AUTH_USERNAME ?? 'otorres',
        BASIC_AUTH_PASSWORD: process.env.BASIC_AUTH_PASSWORD ?? 'test_password',
      },
    })

    // --- IAM: least-privilege access to the three backends ---
    docsBucket.grantReadWrite(honoLambda)

    honoLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3vectors:PutVectors', 's3vectors:QueryVectors', 's3vectors:GetVectors', 's3vectors:DeleteVectors', 's3vectors:ListVectors'],
      resources: ['*'], // S3 Vectors ARNs are account/region-scoped; '*' is fine for a POC
    }))

    // Bedrock: embeddings use a bare foundation-model ARN; the chat model is a
    // cross-region inference profile, which needs the profile ARN PLUS the underlying
    // foundation-model ARN in every region the profile can route to.
    const chatBaseModelId = CHAT_MODEL_ID.replace(/^[a-z]{2}\./, '') // strip "us." prefix
    honoLambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/${EMBEDDING_MODEL_ID}`,
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${CHAT_MODEL_ID}`,
        ...INFERENCE_PROFILE_REGIONS.map((r) => `arn:aws:bedrock:${r}::foundation-model/${chatBaseModelId}`),
      ],
    }))

    // ---------------------------------------------------------------------------
    // 4. Function URL with response streaming so /chat can stream tokens (SSE).
    // ---------------------------------------------------------------------------
    const fnUrl = honoLambda.addFunctionUrl({
      authType: aws_lambda.FunctionUrlAuthType.NONE,
      invokeMode: aws_lambda.InvokeMode.RESPONSE_STREAM,
    })

    new CfnOutput(this, 'ApiUrl', { value: fnUrl.url })
    new CfnOutput(this, 'DocsBucketName', { value: docsBucket.bucketName })
    new CfnOutput(this, 'VectorBucketName', { value: vectorBucketName })
    new CfnOutput(this, 'VectorIndexName', { value: vectorIndexName })
  }
}
