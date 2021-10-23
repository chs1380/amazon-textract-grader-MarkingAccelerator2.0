import { PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sns from '@aws-cdk/aws-sns';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { Choice, Pass, StateMachine, Wait } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { WaitTime } from '@aws-cdk/aws-stepfunctions/lib/states/wait';
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
        ClientRequestToken: sfn.JsonPath.stringAt('$$.Execution.Name'),
        DocumentLocation: {
          S3Object: {
            Bucket: this.pdfSourceBucket.bucketName,
            Name: sfn.JsonPath.stringAt('$.key'),
          },
        },
        FeatureTypes: ['FORMS'],
        JobTag: sfn.JsonPath.stringAt('$$.Execution.Name'),
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
      resultSelector: {
        JobId: sfn.JsonPath.stringAt('$.JobId'),
      },
      resultPath: '$.textract',
    });

    const getDocumentAnalysis = new tasks.CallAwsService(this, 'GetDocumentAnalysis', {
      service: 'textract',
      action: 'getDocumentAnalysis',
      parameters: {
        JobId: sfn.JsonPath.stringAt('$.textract.JobId'),
      },
      iamResources: ['*'],
      iamAction: 'textract:GetDocumentAnalysis',
      resultSelector: {
        JobStatus: sfn.JsonPath.stringAt('$.JobStatus'),
      },
      resultPath: '$.status',
    });

    const jobFailed = new sfn.Fail(this, 'Job Failed', {
      cause: 'Amazon Textract Job Failed',
      error: 'DescribeJob returned FAILED',
    });
    const jobFinish = new sfn.Pass(this, 'Job Finish', {
      comment: 'AWS Textract Job Finish',
      parameters: {
        key: sfn.JsonPath.stringAt('$.key'),
        JobId: sfn.JsonPath.stringAt('$.textract.JobId'),
        textractPrefix: sfn.JsonPath.stringAt('States.Format(\'{}/{}\', $.key, $.textract.JobId)'),
      },
    });

    const handleDataLimitExceeded = new Pass(this, 'DataLimitExceeded').next(jobFinish);
    getDocumentAnalysis.addCatch(handleDataLimitExceeded, {
      errors: ['States.DataLimitExceeded'],
      resultPath: '$.error-info',
    });

    const wait = new Wait(this, 'Wait 1 minute', {
      comment: 'Wait 1 minute\'',
      time: WaitTime.duration(Duration.minutes(1)),
    });

    const choice = new Choice(this, 'Check Job Status')
      .when(sfn.Condition.stringEquals('$.status.JobStatus', 'FAILED'), jobFailed)
      .when(sfn.Condition.stringEquals('$.status.JobStatus', 'SUCCEEDED'), jobFinish)
      .otherwise(wait);

    const definition = runAmazonTextract.next(wait).next(getDocumentAnalysis).next(choice);

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
