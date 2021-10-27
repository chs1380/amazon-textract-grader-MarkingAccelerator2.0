import * as dynamodb from '@aws-cdk/aws-dynamodb';
import { Table } from '@aws-cdk/aws-dynamodb';
import { ILayerVersion } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';
import { LambdaHelper } from './lib/lambda-helper';

export interface TransformFormResultStateMachineConstructProps {
  sourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class TransformFormResultStateMachineConstruct extends Construct {
  public readonly sourceBucket: Bucket;
  public readonly destinationBucket: Bucket;
  public readonly stateMachine: StateMachine;
  private readonly lambdaHelper: LambdaHelper;
  private textractBlockTable: Table;

  constructor(scope: Construct, id: string, props: TransformFormResultStateMachineConstructProps) {
    super(scope, id);
    this.lambdaHelper = new LambdaHelper(this);
    this.sourceBucket = props.sourceBucket;
    this.destinationBucket = props.destinationBucket;

    this.textractBlockTable = new dynamodb.Table(this, 'TextractBlockTable', {
      partitionKey: {
        name: 'Key',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SortKey',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
    });

    const saveBlockKeyValuePairFunction = this.getLambdaFunction('save-block-key-value-pair',
      []);
    this.sourceBucket.grantReadWrite(saveBlockKeyValuePairFunction);
    this.textractBlockTable.grantReadWriteData(saveBlockKeyValuePairFunction);

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
        //https://docs.aws.amazon.com/AmazonS3/latest/userguide/ListingKeysUsingAPIs.html
        //List results are always returned in UTF-8 binary order and remove the first item.
        Contents: sfn.JsonPath.listAt('$.Contents[1:]'),
      },
      resultPath: '$.results',
    });

    const saveBlockKeyValuePairTask = this.lambdaHelper.getLambdaInvokeTask(saveBlockKeyValuePairFunction);
    const mapPageKey = new sfn.Map(this, 'Parallel Process pages', {
      maxConcurrency: 100,
      itemsPath: sfn.JsonPath.stringAt('$.results.Contents'),
      parameters: {
        prefix: sfn.JsonPath.stringAt('$.textractPrefix'),
        key: sfn.JsonPath.stringAt('$$.Map.Item.Value.Key'),
      },
      resultPath: sfn.JsonPath.DISCARD, //Discard the Result and Keep the Original Input.
    });
    mapPageKey.iterator(saveBlockKeyValuePairTask);

    const generateQuestionAnswerFunction = this.getLambdaFunction('generate-question-answer-pair',
      []);
    this.destinationBucket.grantWrite(generateQuestionAnswerFunction);
    this.textractBlockTable.grantFullAccess(generateQuestionAnswerFunction);
    const generateQuestionAnswerTask = this.lambdaHelper.getLambdaInvokeTask(generateQuestionAnswerFunction);

    const definition = getTextractResultList.next(mapPageKey).next(generateQuestionAnswerTask);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[]) {
    const environment = {
      SourceBucket: this.sourceBucket.bucketName,
      DestinationBucket: this.destinationBucket.bucketName,
      TextractBlockTable: this.textractBlockTable.tableName,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment);
  }
}