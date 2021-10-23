import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';

export interface TransformFormResultStateMachineConstructProps {
  sourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class TransformFormResultStateMachineConstruct extends Construct {
  public readonly sourceBucket: Bucket;
  public readonly destinationBucket: Bucket;
  public readonly stateMachine: StateMachine;


  constructor(scope: Construct, id: string, props: TransformFormResultStateMachineConstructProps) {
    super(scope, id);

    this.sourceBucket = props.sourceBucket;
    this.destinationBucket = props.destinationBucket;

    const getTextractResultList = new tasks.CallAwsService(this, 'GetTextractResultList', {
      service: 's3',
      action: 'listObjectsV2',
      parameters: {
        Bucket: this.sourceBucket.bucketName,
        Prefix: sfn.JsonPath.stringAt('$.textractPrefix'),
        MaxKeys: 1000,
      },
      iamResources: [this.sourceBucket.bucketArn],
      iamAction: 's3:ListBucket',
      resultSelector: {
        Contents: sfn.JsonPath.stringAt('$.Contents'),
      },
      resultPath: '$.results',
    });

    const mapPageKey = new sfn.Map(this, 'Parallel Process pages', {
      maxConcurrency: 1,
      itemsPath: sfn.JsonPath.stringAt('$.results.Contents'),
      parameters: {
        prefix: sfn.JsonPath.stringAt('$.textractPrefix'),
        key: sfn.JsonPath.stringAt('$$.Map.Item.Value.Key'),
      },
    });
    mapPageKey.iterator(new sfn.Pass(this, 'Pass State'));

    const definition = getTextractResultList.next(mapPageKey);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }
}