import { ILayerVersion } from '@aws-cdk/aws-lambda';
import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { Condition, Pass, StateMachine, Wait } from '@aws-cdk/aws-stepfunctions';
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
    const ghostscriptLayer = this.lambdaHelper.getLayerVersion('ghostscript/ghostscript.zip');
    const imageMagickLayer = this.lambdaHelper.getLayerVersion('image-magick/layer.zip');
    const sharpLayer = this.lambdaHelper.getLayerVersion('sharp/');
    const pdfkitLayer = this.lambdaHelper.getLayerVersion('pdfkit/');

    const pdfToImagesFunction = this.getLambdaFunction('pdf-to-Images',
      [ghostscriptLayer, imageMagickLayer]);
    this.imageBucket.grantWrite(pdfToImagesFunction);
    this.pdfSourceBucket.grantRead(pdfToImagesFunction);

    const analyzeDocumentImagesFunction = this.getLambdaFunction('analyze-document-images', []);
    analyzeDocumentImagesFunction.role?.addManagedPolicy({ managedPolicyArn: 'arn:aws:iam::aws:policy/AmazonRekognitionReadOnlyAccess' });
    this.imageBucket.grantReadWrite(analyzeDocumentImagesFunction);

    const correctImageOrientationFunction = this.getLambdaFunction('correct-image-orientation',
      [sharpLayer]);
    this.imageBucket.grantReadWrite(correctImageOrientationFunction);

    const imagesToPdfFunction = this.getLambdaFunction('images-to-pdf',
      [pdfkitLayer]);
    this.imageBucket.grantRead(imagesToPdfFunction);
    this.pdfDestinationBucket.grantWrite(imagesToPdfFunction);

    const pdfToImagesTask = this.lambdaHelper.getLambdaInvokeTask(pdfToImagesFunction);
    const analyzeDocumentImagesTask = this.lambdaHelper.getLambdaInvokeTask(analyzeDocumentImagesFunction);
    const correctImageOrientationTask = this.lambdaHelper.getLambdaInvokeTask(correctImageOrientationFunction);
    const imagesToPdfTask = this.lambdaHelper.getLambdaInvokeTask(imagesToPdfFunction);

    const skipRotationChoice = new sfn.Choice(this, 'Skip Rotation Choice');
    skipRotationChoice.when(Condition.isPresent('$.skipRotation'), new Pass(this, 'Skip Fixing Rotation'));
    skipRotationChoice.otherwise(analyzeDocumentImagesTask
      .next(correctImageOrientationTask).next(new Wait(this, 'Wait 5 seconds', {
        comment: 'Wait 5 seconds',
        time: WaitTime.duration(Duration.seconds(5)),
      })));
    skipRotationChoice.afterwards().next(imagesToPdfTask);

    const definition = pdfToImagesTask.next(skipRotationChoice);
    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[]) {
    const environment = {
      ImagesBucket: this.imageBucket.bucketName,
      PdfSourceBucket: this.pdfSourceBucket.bucketName,
      PdfDestinationBucket: this.pdfDestinationBucket.bucketName,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment);
  }

}