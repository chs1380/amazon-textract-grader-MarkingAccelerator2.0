import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { Code, Runtime } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import { Construct, Duration, RemovalPolicy } from '@aws-cdk/core';


export interface CorrectPdfOrientationConstructProps {
  prefix?: string;
}

export class CorrectPdfOrientationConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  constructor(scope: Construct, id: string, props: CorrectPdfOrientationConstructProps = {}) {
    super(scope, id);
    console.log(props.prefix);

    this.pdfSourceBucket = new Bucket(this, 'ImageBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const imageBucket = new Bucket(this, 'ImageBucket', {
      autoDeleteObjects: true,
      lifecycleRules: [{
        expiration: Duration.days(7),
      }],
      removalPolicy: RemovalPolicy.DESTROY,
    });
    //Source https://github.com/shelfio/ghostscript-lambda-layer
    const ghostscriptLayer = lambda.LayerVersion.fromLayerVersionArn(this, 'GhostscriptLayer',
      'arn:aws:lambda:us-east-1:764866452798:layer:ghostscript:8');
    new lambda.Function(this, 'PdfToImagesFunction', {
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.minutes(15),
      handler: 'app.lambdaHandler',
      code: Code.fromAsset(path.join(__dirname, 'pdf-to-Images/')),
      layers: [ghostscriptLayer],
      environment: { ImagesBucket: imageBucket.bucketName },
    });
  }
}