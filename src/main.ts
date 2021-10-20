import { App, Construct, Stack, StackProps } from '@aws-cdk/core';
import { CorrectPdfOrientationConstruct } from './construct/correct-pdf-orientation-construct';

export class AmazonTextractGraderStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps = {}) {
    super(scope, id, props);

    new CorrectPdfOrientationConstruct(this, 'CorrectPdfOrientationConstruct', { prefix: '' });
    // define resources here...
  }
}

// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT || '111964674713',
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const app = new App();

new AmazonTextractGraderStack(app, 'amazon-textract-grader-dev', { env: devEnv });
// new MyStack(app, 'my-stack-prod', { env: prodEnv });

app.synth();