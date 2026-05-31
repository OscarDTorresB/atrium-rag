import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs'

/**
 * The static frontend, deployed independently of the API.
 *
 * A private S3 bucket holds the built `web/dist`; CloudFront serves it over HTTPS and
 * reaches the bucket through Origin Access Control (OAC), so the site is never publicly
 * readable from S3 directly. Kept in its own stack so the frontend and backend can be
 * deployed and torn down on separate lifecycles.
 *
 * The API trusts this site's CloudFront origin for CORS — `distributionUrl` is exposed
 * so the app entry can pass it into the API stack (a one-way reference; the frontend
 * learns the API URL at build time, not at synth, so there is no cycle).
 */
export class RagWebStack extends Stack {
  /** `https://<cloudfront-domain>` — pass to the API stack as its allowed CORS origin. */
  public readonly distributionUrl: string

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const siteBucket = new Bucket(this, 'WebBucket', {
      removalPolicy: RemovalPolicy.DESTROY, // POC: tear down cleanly
      autoDeleteObjects: true,
    })

    const distribution = new Distribution(this, 'WebDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // Single-page app: serve index.html for unknown paths instead of S3's XML error.
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    })

    // Upload the built frontend and invalidate the CDN cache on every deploy.
    // NOTE: requires `pnpm --filter @rag/web build` to have produced web/dist first.
    new BucketDeployment(this, 'WebDeployment', {
      sources: [Source.asset('../web/dist')],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
    })

    this.distributionUrl = `https://${distribution.distributionDomainName}`

    new CfnOutput(this, 'SiteUrl', { value: this.distributionUrl })
  }
}
