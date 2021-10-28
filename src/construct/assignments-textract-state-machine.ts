import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { IntegrationPattern, StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';
import { AmazonTextractMultiPagesDocumentsStateMachineConstruct } from './amazon-textract-multi-pages-documents-state-machine-construct';
import { CorrectPdfOrientationStateMachineConstruct } from './correct-pdf-orientation-state-machine-construct';
import { TransformFormResultStateMachineConstruct } from './transform-form-result-state-machine-construct';


export interface AssignmentsTextractStateMachineConstructStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  pdfDestinationBucket: Bucket;
}

export class AssignmentsTextractStateMachineConstruct extends Construct {
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: AssignmentsTextractStateMachineConstructStateMachineConstructProps) {
    super(scope, id);

    const pdfSourceBucket = props.pdfSourceBucket;
    const pdfDestinationBucket = props.pdfSourceBucket;
    const correctPdfOrientationStateMachineConstruct = new CorrectPdfOrientationStateMachineConstruct(this, 'CorrectPdfOrientationStateMachineConstruct', {
      pdfSourceBucket,
      pdfDestinationBucket,
    });
    const amazonTextractMultiPagesDocumentsStateMachineConstruct = new AmazonTextractMultiPagesDocumentsStateMachineConstruct(this, 'AmazonTextractMultiPagesDocumentsStateMachineConstruct', {
      pdfSourceBucket,
      destinationBucket: pdfDestinationBucket,
    });

    const transformFormResultStateMachineConstruct = new TransformFormResultStateMachineConstruct(this, 'TransformFormResultStateMachineConstruct', {
      sourceBucket: pdfDestinationBucket,
      destinationBucket: pdfDestinationBucket,
    });

    const correctPdfOrientationStateMachineExecution = new tasks.StepFunctionsStartExecution(this, 'CorrectPdfOrientationStateMachineExecution', {
      stateMachine: correctPdfOrientationStateMachineConstruct.stateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
      resultPath: '$.results',
      outputPath: '$.results',
    });

    const amazonTextractMultiPagesDocumentsStateMachineExecution = new tasks.StepFunctionsStartExecution(this, 'AmazonTextractMultiPagesDocumentsStateMachineExecution', {
      stateMachine: amazonTextractMultiPagesDocumentsStateMachineConstruct.stateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
      inputPath: '$.results',
      resultPath: '$.results',
      outputPath: '$.results',
    });
    const transformFormResultStateMachineExecution = new tasks.StepFunctionsStartExecution(this, 'TransformFormResultStateMachineExecution', {
      stateMachine: transformFormResultStateMachineConstruct.stateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
      inputPath: '$.results',
      resultPath: '$.results',
      outputPath: '$.results',
    });

    const definition = correctPdfOrientationStateMachineExecution
      .next(amazonTextractMultiPagesDocumentsStateMachineExecution)
      .next(transformFormResultStateMachineExecution);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }
}