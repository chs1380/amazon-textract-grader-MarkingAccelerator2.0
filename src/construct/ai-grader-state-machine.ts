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

    const calculateTextSimilarityFunction = new lambda.DockerImageFunction(this, 'Calculate Text Similarity Function', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '/lambda/calculate-answer-similarity'), {
        cmd: ['similarity.handler'],
      }),
      memorySize: 8096,
      timeout: Duration.seconds(600),
      environment: {
        DestinationBucket: this.destinationBucket.bucketName,
      },
    });
    this.destinationBucket.grantReadWrite(calculateTextSimilarityFunction);

    //save-answer-similarity

    const saveAnswerSimilarityFunction = this.getLambdaFunction('save-answer-similarity',
      []);
    this.destinationBucket.grantReadWrite(saveAnswerSimilarityFunction);
    const saveAnswerSimilarityTask = this.lambdaHelper.getLambdaInvokeTask(saveAnswerSimilarityFunction);

    const jsonToExcelFunction = this.getLambdaFunction('json-to-excel',
      [], 'Similarity');
    this.destinationBucket.grantReadWrite(jsonToExcelFunction);
    const jsonToExcelTask = this.lambdaHelper.getLambdaInvokeTask(jsonToExcelFunction);

    const textSimilarityTask = this.lambdaHelper.getLambdaInvokeTask(calculateTextSimilarityFunction);
    const mapAnswerKey = new sfn.Map(this, 'Parallel Process Answer', {
      maxConcurrency: 3,
      itemsPath: sfn.JsonPath.stringAt('$.matchResults'),
      parameters: {
        question: sfn.JsonPath.stringAt('$$.Map.Item.Value.question'),
        key: sfn.JsonPath.stringAt('$$.Map.Item.Value.s3Key'),
      },
      resultPath: sfn.JsonPath.DISCARD, //Discard the Result and Keep the Original Input.
    });
    mapAnswerKey.iterator(textSimilarityTask.next(saveAnswerSimilarityTask));

    const definition = readStandardAnswerJson.next(joinAnswerTask).next(mapAnswerKey).next(jsonToExcelTask);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });

  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[], suffix: string = '') {
    const environment = {
      SourceBucket: this.pdfSourceBucket.bucketName,
      DestinationBucket: this.destinationBucket.bucketName,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment, suffix);
  }
}