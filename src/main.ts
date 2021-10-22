import { Bucket } from '@aws-cdk/aws-s3';
import { App, CfnOutput, Construct, RemovalPolicy, Stack, StackProps } from '@aws-cdk/core';
import { AmazonTextractMultiPagesDocumentsStateMachineConstruct } from './construct/amazon-textract-multi-pages-documents-state-machine-construct';
import { CorrectPdfOrientationStateMachineConstruct } from './construct/correct-pdf-orientation-state-machine-construct';

export class AmazonTextractGraderStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    const pdfSourceBucket = new Bucket(this, 'PdfSourceBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const pdfDestinationBucket = new Bucket(this, 'PdfDestinationBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new CorrectPdfOrientationStateMachineConstruct(this, 'CorrectPdfOrientationStateMachineConstruct', {
      pdfSourceBucket,
      pdfDestinationBucket,
    });
    new AmazonTextractMultiPagesDocumentsStateMachineConstruct(this, 'AmazonTextractMultiPagesDocumentsStateMachineConstruct', {
      pdfSourceBucket,
      destinationBucket: pdfDestinationBucket,
    });

    new CfnOutput(this, 'PdfSourceBucketOutput', {
      value: pdfSourceBucket.bucketName,
    });

    new CfnOutput(this, 'PdfDestinationBucketOutput', {
      value: pdfDestinationBucket.bucketName,
    });
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '111964674713',
  region: 'us-east-1',
};

const app = new App();

new AmazonTextractGraderStack(app, 'amazon-textract-grader-dev', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });

app.synth();