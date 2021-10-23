import { ILayerVersion } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { StateMachine, Wait } from '@aws-cdk/aws-stepfunctions';
import { WaitTime } from '@aws-cdk/aws-stepfunctions/lib/states/wait';
import { Construct, Duration, RemovalPolicy } from '@aws-cdk/core';
import { LambdaHelper } from './lib/lambda-helper';


export interface CorrectPdfOrientationStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  pdfDestinationBucket: Bucket;
}

export class CorrectPdfOrientationStateMachineConstruct extends Construct {
  public readonly pdfSourceBucket: Bucket;
  private imageBucket: Bucket;
  public readonly pdfDestinationBucket: Bucket;
  public readonly stateMachine: StateMachine;
  private readonly lambdaHelper: LambdaHelper;

  constructor(scope: Construct, id: string, props: CorrectPdfOrientationStateMachineConstructProps) {
    super(scope, id);

    this.lambdaHelper = new LambdaHelper(this);
    this.pdfSourceBucket = props.pdfSourceBucket;
    this.pdfDestinationBucket = props.pdfDestinationBucket;

    this.imageBucket = new Bucket(this, 'ImageBucket', {
      autoDeleteObjects: true,
      lifecycleRules: [{
        expiration: Duration.days(7),
      }],
      removalPolicy: RemovalPolicy.DESTROY,
    });

    //Source https://github.com/shelfio/ghostscript-lambda-layer
    const ghostscriptLayer = this.lambdaHelper.getLayerVersion('GhostscriptLayer', 'ghostscript/ghostscript.zip');
    const imageMagickLayer = this.lambdaHelper.getLayerVersion('ImageMagickLayer', 'image-magick/layer.zip');
    const sharpLayer = this.lambdaHelper.getLayerVersion('SharpLayer', 'sharp/');
    const pdfkitLayer = this.lambdaHelper.getLayerVersion('PdfkitLayer', 'pdfkit/');

    const pdfToImagesFunction = this.getLambdaFunction('PdfToImagesFunction', 'pdf-to-Images/',
      [ghostscriptLayer, imageMagickLayer]);
    this.imageBucket.grantWrite(pdfToImagesFunction);
    this.pdfSourceBucket.grantRead(pdfToImagesFunction);

    const analyzeDocumentImagesFunction = this.getLambdaFunction('AnalyzeDocumentImagesFunction', 'analyze-document-images/', []);
    analyzeDocumentImagesFunction.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonRekognitionReadOnlyAccess' });
    this.imageBucket.grantReadWrite(analyzeDocumentImagesFunction);

    const correctImageOrientationFunction = this.getLambdaFunction('CorrectImageOrientationFunction', 'correct-image-orientation/',
      [sharpLayer]);
    this.imageBucket.grantReadWrite(correctImageOrientationFunction);

    const imagesToPdfFunction = this.getLambdaFunction('ImagesToPdfFunction', 'images-to-pdf/',
      [pdfkitLayer]);
    this.imageBucket.grantReadWrite(imagesToPdfFunction);

    const pdfToImagesTask = this.lambdaHelper.getLambdaInvokeTask('PdfToImagesTask', pdfToImagesFunction);
    const analyzeDocumentImagesTask = this.lambdaHelper.getLambdaInvokeTask('AnalyzeDocumentImagesTask', analyzeDocumentImagesFunction);
    const correctImageOrientationTask = this.lambdaHelper.getLambdaInvokeTask('CorrectImageOrientationTask', correctImageOrientationFunction);
    const imagesToPdfTask = this.lambdaHelper.getLambdaInvokeTask('ImagesToPdfTask', imagesToPdfFunction);

    const definition = pdfToImagesTask
      .next(analyzeDocumentImagesTask)
      .next(correctImageOrientationTask).next(new Wait(this, 'Wait 5 seconds', {
        comment: 'Wait 5 seconds',
        time: WaitTime.duration(Duration.seconds(5)),
      }))
      .next(imagesToPdfTask);
    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }

  private getLambdaFunction(functionName: string, assetPath: string, layers: ILayerVersion[]) {
    const environment = {
      ImagesBucket: this.imageBucket.bucketName,
      PdfSourceBucket: this.pdfSourceBucket.bucketName,
      PdfDestinationBucket: this.pdfDestinationBucket.bucketName,
    };
    return this.lambdaHelper.getLambdaFunction(functionName, assetPath, layers, environment);
  }

}