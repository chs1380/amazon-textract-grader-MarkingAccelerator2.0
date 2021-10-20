import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { Code, Runtime } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration, RemovalPolicy } from '@aws-cdk/core';


export interface CorrectPdfOrientationConstructProps {
  prefix?: string;
}

export class CorrectPdfOrientationConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;

  constructor(scope: Construct, id: string, props: CorrectPdfOrientationConstructProps = {}) {
    super(scope, id);
    console.log(props.prefix);

    this.pdfSourceBucket = new Bucket(this, 'PdfSourceBucket', {
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
    const ghostscriptLayer = new lambda.LayerVersion(this, 'ghostscriptLayer', {
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_14_X,
      ],
      code: Code.fromAsset(path.join(__dirname, 'layer/ghostscript/ghostscript.zip')),
    });

    const imageMagickLayer = new lambda.LayerVersion(this, 'ImageMagickLayer', {
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_14_X,
      ],
      code: Code.fromAsset(path.join(__dirname, 'layer/image-magick/layer.zip')),
    });
    const pdfToImagesFunction = new lambda.Function(this, 'PdfToImagesFunction', {
      runtime: Runtime.NODEJS_14_X,
      timeout: Duration.minutes(15),
      handler: 'app.lambdaHandler',
      code: Code.fromAsset(path.join(__dirname, 'pdf-to-Images/')),
      layers: [ghostscriptLayer, imageMagickLayer],
      environment: {
        ImagesBucket: imageBucket.bucketName,
        PdfSourceBucket: this.pdfSourceBucket.bucketName,
      },
    });
    imageBucket.grantReadWrite(pdfToImagesFunction);
    this.pdfSourceBucket.grantRead(pdfToImagesFunction);

    const pdfToImagesTask = new tasks.LambdaInvoke(this, 'PdfToImagesTask', {
      lambdaFunction: pdfToImagesFunction,
      // Lambda's result is in the attribute `Payload`
      outputPath: '$.Payload',
    });

    const definition = pdfToImagesTask;
    new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(5),
    });
  }
}