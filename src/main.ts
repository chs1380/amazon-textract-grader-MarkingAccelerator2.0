import { App, CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { SubscriptionFilter } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

import { Construct } from 'constructs';
import { AssignmentsTextractStateMachineConstruct } from './construct/assignments-textract-state-machine';


export class AmazonTextractGraderStack extends Stack {
  private assignmentsTextractStateMachineConstruct: AssignmentsTextractStateMachineConstruct;

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

    this.assignmentsTextractStateMachineConstruct = new AssignmentsTextractStateMachineConstruct(this, 'AssignmentsTextractStateMachineConstruct', {
      pdfSourceBucket,
      pdfDestinationBucket,
    });

    const email = this.node.tryGetContext('email');
    this.addEmailSubscription(email);

    new CfnOutput(this, 'PdfSourceBucketOutput', {
      value: pdfSourceBucket.bucketName,
    });

    new CfnOutput(this, 'PdfDestinationBucketOutput', {
      value: pdfDestinationBucket.bucketName,
    });

    new CfnOutput(this, 'HumanApprovalTopicOutput', {
      value: this.assignmentsTextractStateMachineConstruct.approvalTopic.topicArn,
    });
  }

  private addEmailSubscription(email: string) {
    this.assignmentsTextractStateMachineConstruct.approvalTopic.addSubscription(new EmailSubscription(email, {
      filterPolicy: {
        email: SubscriptionFilter.stringFilter({
          allowlist: [email],
        }),
      },
    }));
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