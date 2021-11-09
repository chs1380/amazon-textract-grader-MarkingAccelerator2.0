import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import { Construct, Duration } from '@aws-cdk/core';

export interface AiGraderStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  destinationBucket: Bucket;
}

export class AiGraderStateMachineConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  public readonly destinationBucket: Bucket;

  // public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: AiGraderStateMachineConstructProps) {
    super(scope, id);
    this.pdfSourceBucket = props.pdfSourceBucket;
    this.destinationBucket = props.destinationBucket;

    new lambda.DockerImageFunction(this, 'Text Similarity', {
      code: lambda.DockerImageCode.fromImageAsset(path.join(__dirname, '/lambda/calculate-answer-similarity'), {
        cmd: ['similarity.py'],
      }),
      memorySize: 8096,
      timeout: Duration.seconds(600),
    });
  }
}