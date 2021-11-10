import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { ILayerVersion } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';
import { LambdaHelper } from './lib/lambda-helper';

export interface AiGraderStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class AiGraderStateMachineConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  public readonly destinationBucket: Bucket;

  public readonly stateMachine: StateMachine;
  private lambdaHelper: LambdaHelper;

  constructor(scope: Construct, id: string, props: AiGraderStateMachineConstructProps) {
    super(scope, id);
    this.lambdaHelper = new LambdaHelper(this);
    this.pdfSourceBucket = props.pdfSourceBucket;
    this.destinationBucket = props.destinationBucket;

    new lambda.DockerImageFunction(this, 'Text Similarity', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '/lambda/calculate-answer-similarity'), {
        cmd: ['similarity.handler'],
      }),
      memorySize: 8096,
      timeout: Duration.seconds(600),
    });
    const readStandardAnswerJson = new tasks.CallAwsService(this, 'ReadStandardAnswerJson', {
      service: 's3',
      action: 'getObject',
      parameters: {
        Bucket: this.destinationBucket.bucketName,
        Key: sfn.JsonPath.stringAt('$.standardAnswer.keyValuePairJson'),
      },
      iamResources: [this.destinationBucket.arnForObjects('*')],
      resultSelector: {
        QuestionAndAnswerList: sfn.JsonPath.stringAt('States.StringToJson($.Body)'),
      },
      resultPath: '$.result',
    });

    const joinAnswerFunction = this.getLambdaFunction('join-answer',
      []);
    this.destinationBucket.grantReadWrite(joinAnswerFunction);
    const joinAnswerTask = this.lambdaHelper.getLambdaInvokeTask(joinAnswerFunction);

    const definition = readStandardAnswerJson.next(joinAnswerTask);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });

  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[]) {
    const environment = {
      SourceBucket: this.pdfSourceBucket.bucketName,
      DestinationBucket: this.destinationBucket.bucketName,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment);
  }
}