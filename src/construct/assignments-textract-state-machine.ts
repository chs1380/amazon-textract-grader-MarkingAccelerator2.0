import { Bucket } from '@aws-cdk/aws-s3';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { IntegrationPattern, StateMachine, TaskInput } from '@aws-cdk/aws-stepfunctions';
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
    const pdfDestinationBucket = props.pdfDestinationBucket;
    const correctPdfOrientationStateMachineConstruct = new CorrectPdfOrientationStateMachineConstruct(this, 'CorrectPdfOrientationStateMachineConstruct', {
      pdfSourceBucket,
      pdfDestinationBucket,
    });
    const amazonTextractMultiPagesDocumentsStateMachineConstruct = new AmazonTextractMultiPagesDocumentsStateMachineConstruct(this, 'AmazonTextractMultiPagesDocumentsStateMachineConstruct', {
      pdfSourceBucket: pdfDestinationBucket,
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

    const standardAnswerAmazonTextractMultiPagesDocumentsStateMachineExecution = this.getStateMachineExecution(
      'StandardAnswerAmazonTextractMultiPagesDocumentsStateMachineExecution', amazonTextractMultiPagesDocumentsStateMachineConstruct.stateMachine);

    const scriptsAnswerAmazonTextractMultiPagesDocumentsStateMachineExecution = this.getStateMachineExecution(
      'ScriptsAmazonTextractMultiPagesDocumentsStateMachineExecution', amazonTextractMultiPagesDocumentsStateMachineConstruct.stateMachine);

    const standardAnswerTransformFormResultStateMachineExecution = this.getStateMachineExecution(
      'StandardAnswerTransformFormResultStateMachineExecution', transformFormResultStateMachineConstruct.stateMachine, '$.Output');

    const scriptsAnswerTransformFormResultStateMachineExecution = this.getStateMachineExecution(
      'ScriptsAnswerTransformFormResultStateMachineExecution', transformFormResultStateMachineConstruct.stateMachine, '$.Output');

    const start = new sfn.Pass(this, 'StartPass');
    const standardAnswerPass = new sfn.Pass(this, 'StandardAnswerPass', {
      parameters: {
        key: sfn.JsonPath.stringAt('$.standardAnswerKey'),
      },
      resultPath: '$.Input',
    });
    const scriptsPass = new sfn.Pass(this, 'ScriptsPass', {
      parameters: {
        key: sfn.JsonPath.stringAt('$.scriptsKey'),
      },
    });

    const parallel = new sfn.Parallel(this, 'ProcessParallel');
    parallel.branch(scriptsPass
      .next(correctPdfOrientationStateMachineExecution)
      .next(scriptsAnswerAmazonTextractMultiPagesDocumentsStateMachineExecution)
      .next(scriptsAnswerTransformFormResultStateMachineExecution));
    parallel.branch(standardAnswerPass
      .next(standardAnswerAmazonTextractMultiPagesDocumentsStateMachineExecution)
      .next(standardAnswerTransformFormResultStateMachineExecution));
    const definition = start.next(parallel);

    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });
  }

  private getStateMachineExecution(sid: string, stateMachine: StateMachine, inputPath: string = '$.Input') {
    return new tasks.StepFunctionsStartExecution(this, sid, {
      stateMachine: stateMachine,
      integrationPattern: IntegrationPattern.RUN_JOB,
      input: TaskInput.fromJsonPathAt(inputPath),
      resultPath: '$.results',
      outputPath: '$.results',
    });
  }
}