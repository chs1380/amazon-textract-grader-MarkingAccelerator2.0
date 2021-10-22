import { PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sns from '@aws-cdk/aws-sns';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';


export interface AmazonTextractMultiPagesDocumentsConstructStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class AmazonTextractMultiPagesDocumentsStateMachineConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  public readonly destinationBucket: Bucket;
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: AmazonTextractMultiPagesDocumentsConstructStateMachineConstructProps) {
    super(scope, id);
    this.pdfSourceBucket = props.pdfSourceBucket;
    this.destinationBucket = props.destinationBucket;

    const amazonTextractJobCompleteTopic = new sns.Topic(this, 'AmazonTextractJobCompleteTopic');

    const textractExecutionRole = new Role(this, 'TextractExecutionRole', {
      assumedBy: new ServicePrincipal('textract.amazonaws.com'),
    });

    textractExecutionRole.addToPolicy(new PolicyStatement({
      resources: [amazonTextractJobCompleteTopic.topicArn],
      actions: ['SNS:Publish'],
    }));


    const runAmazonTextract = new tasks.CallAwsService(this, 'RunAmazonTextract', {
      service: 'textract',
      action: 'startDocumentAnalysis',
      parameters: {
        ClientRequestToken: sfn.JsonPath.stringAt('$$.Execution.Id'),
        DocumentLocation: {
          S3Object: {
            Bucket: this.pdfSourceBucket.bucketName,
            Name: sfn.JsonPath.stringAt('$.key'),
          },
        },
        FeatureTypes: ['FORMS'],
        JobTag: sfn.JsonPath.stringAt('$$.Execution.Id'),
        // NotificationChannel: {
        //   RoleArn: textractExecutionRole.roleArn,
        //   SnsTopicArn: amazonTextractJobCompleteTopic.topicArn,
        // },
        OutputConfig: {
          S3Bucket: this.destinationBucket.bucketName,
          S3Prefix: sfn.JsonPath.stringAt('$.key'),
        },
      },
      iamResources: ['*'],
      iamAction: 'textract:StartDocumentAnalysis',
    });

    const definition = runAmazonTextract;

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
    this.stateMachine.role.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: ['*'],
      }),
    );
    this.stateMachine.role.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonTextractFullAccess' });
  }
}
