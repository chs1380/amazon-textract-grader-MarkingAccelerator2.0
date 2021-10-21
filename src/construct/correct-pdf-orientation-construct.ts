import path from 'path';
import * as lambda from '@aws-cdk/aws-lambda';
import { Code, IFunction, ILayerVersion, Runtime } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { Wait } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { WaitTime } from '@aws-cdk/aws-stepfunctions/lib/states/wait';
import { CfnOutput, Construct, Duration, RemovalPolicy } from '@aws-cdk/core';


export interface CorrectPdfOrientationConstructProps {
  prefix?: string;
}

export class CorrectPdfOrientationConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  private imageBucket: Bucket;
  public readonly pdfDestinationBucket: Bucket;

  constructor(scope: Construct, id: string, props: CorrectPdfOrientationConstructProps = {}) {
    super(scope, id);
    console.log(props.prefix);

    this.pdfSourceBucket = new Bucket(this, 'PdfSourceBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    this.pdfDestinationBucket = new Bucket(this, 'PdfDestinationBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.imageBucket = new Bucket(this, 'ImageBucket', {
      autoDeleteObjects: true,
      lifecycleRules: [{
        expiration: Duration.days(7),
      }],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    //Source https://github.com/shelfio/ghostscript-lambda-layer
    const ghostscriptLayer = this.getLayerVersion('GhostscriptLayer', 'ghostscript/ghostscript.zip');
    const imageMagickLayer = this.getLayerVersion('ImageMagickLayer', 'image-magick/layer.zip');
    const sharpLayer = this.getLayerVersion('SharpLayer', 'sharp/');
    const pdfkitLayer = this.getLayerVersion('PdfkitLayer', 'pdfkit/');

    const pdfToImagesFunction = this.getFunction('PdfToImagesFunction', 'pdf-to-Images/',
      [ghostscriptLayer, imageMagickLayer]);
    this.imageBucket.grantWrite(pdfToImagesFunction);
    this.pdfSourceBucket.grantRead(pdfToImagesFunction);

    const analyzeDocumentImagesFunction = this.getFunction('AnalyzeDocumentImagesFunction', 'analyze-document-images/', []);
    analyzeDocumentImagesFunction.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonRekognitionReadOnlyAccess' });
    this.imageBucket.grantReadWrite(analyzeDocumentImagesFunction);

    const correctImageOrientationFunction = this.getFunction('CorrectImageOrientationFunction', 'correct-image-orientation/',
      [sharpLayer]);
    this.imageBucket.grantReadWrite(correctImageOrientationFunction);

    const imagesToPdfFunction = this.getFunction('ImagesToPdfFunction', 'images-to-pdf/',
      [pdfkitLayer]);
    this.imageBucket.grantReadWrite(imagesToPdfFunction);

    const pdfToImagesTask = this.getLambdaInvokeTask('PdfToImagesTask', pdfToImagesFunction);
    const analyzeDocumentImagesTask = this.getLambdaInvokeTask('AnalyzeDocumentImagesTask', analyzeDocumentImagesFunction);
    const correctImageOrientationTask = this.getLambdaInvokeTask('CorrectImageOrientationTask', correctImageOrientationFunction);
    const imagesToPdfTask = this.getLambdaInvokeTask('ImagesToPdfTask', imagesToPdfFunction);

    const definition = pdfToImagesTask
      .next(analyzeDocumentImagesTask)
      .next(correctImageOrientationTask).next(new Wait(this, 'Wait 5 seconds', {
        comment: 'Wait 5 seconds',
        time: WaitTime.duration(Duration.seconds(5)),
      }))
      .next(imagesToPdfTask);
    new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(15),
    });

    new CfnOutput(this, 'PdfSourceBucketOutput', {
      value: this.pdfSourceBucket.bucketName,
    });

    new CfnOutput(this, 'PdfDestinationBucketOutput', {
      value: this.pdfDestinationBucket.bucketName,
    });
  }

  private getLayerVersion(name: string, assetPath: string) {
    return new lambda.LayerVersion(this, name, {
      compatibleRuntimes: [
        lambda.Runtime.NODEJS_14_X,
      ],
      code: Code.fromAsset(path.join(__dirname, 'lambda/layer', assetPath)),
    });
  }

  private getFunction(functionName: string, assetPath: string, layers: ILayerVersion[]) {
    return new lambda.Function(this, functionName, {
      runtime: Runtime.NODEJS_14_X,
      memorySize: 1024,
      timeout: Duration.minutes(15),
      handler: 'app.lambdaHandler',
      code: Code.fromAsset(path.join(__dirname, 'lambda', assetPath)),
      layers: layers,
      environment: {
        ImagesBucket: this.imageBucket.bucketName,
        PdfSourceBucket: this.pdfSourceBucket.bucketName,
        PdfDestinationBucket: this.pdfDestinationBucket.bucketName,
      },
    });
  }

  private getLambdaInvokeTask(name: string, lambdaFunction: IFunction) {
    return new tasks.LambdaInvoke(this, name, {
      lambdaFunction,
      resultPath: '$.results',
      outputPath: '$.results.Payload',
    });
  }
}