import { Bucket } from '@aws-cdk/aws-s3';
import { Topic } from '@aws-cdk/aws-sns';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { Choice, IntegrationPattern, StateMachine, TaskInput } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { Construct, Duration } from '@aws-cdk/core';
import { AiGraderStateMachineConstruct } from './ai-grader-state-machine';
import { HumanApprovalStateMachineConstruct } from './human-approval-state-machine';

export interface GenerateMarkResultStateMachineConstructProps {
  pdfSourceBucket: Bucket;
  pdfDestinationBucket: Bucket;
}

export class GenerateMarkResultStateMachineConstruct extends Construct {
  public readonly stateMachine: StateMachine;
  public readonly approvalTopic: Topic;

  constructor(scope: Construct, id: string, props: GenerateMarkResultStateMachineConstructProps) {
    super(scope, id);

    const pdfSourceBucket = props.pdfSourceBucket;
    const pdfDestinationBucket = props.pdfDestinationBucket;

    const aiGraderStateMachineConstruct = new AiGraderStateMachineConstruct(this, 'AiGraderStateMachineConstruct', {
      pdfSourceBucket,
      destinationBucket: pdfDestinationBucket,
    });
    const humanApprovalStateMachineConstruct = new HumanApprovalStateMachineConstruct(this, 'HumanApprovalStateMachineConstruct', {
      title: 'Please complete Manual mapping task',
      message: 'Please review the mark result. "Approve" to end this marking job and "Reject" after you resubmitted the mapping config and re-generate the results.',
    });
    this.approvalTopic = humanApprovalStateMachineConstruct.approvalTopic;

    const aiGraderStateMachineExecution = this.getStateMachineExecution(
      'AiGraderStateMachineExecution', aiGraderStateMachineConstruct.stateMachine, '$');

    const humanApprovalStateMachineExecution = this.getStateMachineExecution(
      'humanApprovalStateMachineExecution', humanApprovalStateMachineConstruct.stateMachine, '$.Output');

    const regenerate = new sfn.Pass(this, 'Regenerate', {
      outputPath: '$.Input',
    });
    regenerate.next(aiGraderStateMachineExecution);

    const jobFinish = new sfn.Succeed(this, 'Job Finish');
    const choice = new Choice(this, 'Check Status')
      .when(sfn.Condition.stringEquals('$.Output.Status', 'Rejected'), regenerate)
      .otherwise(jobFinish);

    const definition = aiGraderStateMachineExecution
      .next(humanApprovalStateMachineExecution)
      .next(choice);
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