import { Duration } from 'aws-cdk-lib';
import { LambdaRestApi } from 'aws-cdk-lib/aws-apigateway';
import { Policy, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ILayerVersion } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Choice, IntegrationPattern, StateMachine } from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { LambdaHelper } from './lib/lambda-helper';

export interface HumanApprovalStateMachineConstructProps {
  title: string;
  message: string;
  emailInputPath?: string;
  subjectInputPath?: string;
  messageInputPath?: string;
}

export class HumanApprovalStateMachineConstruct extends Construct {
  private lambdaHelper: LambdaHelper;
  public readonly approvalTopic: Topic;
  public readonly stateMachine: StateMachine;
  private readonly props: HumanApprovalStateMachineConstructProps;

  constructor(scope: Construct, id: string, props: HumanApprovalStateMachineConstructProps) {
    super(scope, id);
    this.lambdaHelper = new LambdaHelper(this);
    this.props = props;

    this.approvalTopic = new Topic(this, 'HumanApprovalTopic', {});

    const stepFunctionApprovalFunction = this.getLambdaFunction('stepfunction-approval', []);
    const lambdaRestApi = new LambdaRestApi(this, 'ApprovalApi', {
      handler: stepFunctionApprovalFunction,
    });

    const stepFunctionApprovalEmailFunction = this.getLambdaFunction('stepfunction-approval-email', []);
    this.approvalTopic.grantPublish(stepFunctionApprovalEmailFunction);

    const stepFunctionApprovalEmailTask = new tasks.LambdaInvoke(this, 'stepFunctionApprovalEmailTask', {
      lambdaFunction: stepFunctionApprovalEmailFunction,
      payload: sfn.TaskInput.fromObject({
        ExecutionContext: sfn.JsonPath.entireContext,
        APIGatewayEndpoint: lambdaRestApi.url,
        Email: sfn.JsonPath.stringAt(props.emailInputPath ?? '$.email'),
        Subject: sfn.JsonPath.stringAt(props.subjectInputPath ?? '$.subject'),
        Message: props.messageInputPath ?? sfn.JsonPath.stringAt('$.message'),
      }),
      timeout: Duration.hours(3),
      integrationPattern: IntegrationPattern.WAIT_FOR_TASK_TOKEN,

    });

    const successState = new sfn.Pass(this, 'SuccessState');
    const failureState = new sfn.Pass(this, 'FailureState');
    const choice = new Choice(this, 'ManualApprovalChoice');
    choice.when(sfn.Condition.stringEquals('$.Status', 'Approved'), successState);
    choice.when(sfn.Condition.stringEquals('$.Status', 'Rejected'), failureState);

    const definition = stepFunctionApprovalEmailTask.next(choice);
    this.stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: Duration.minutes(180),
    });

    const sendTaskResultPolicy = new Policy(this, 'SendTaskResult', {
      statements: [new PolicyStatement({
        resources: ['*'],
        actions: ['states:SendTaskFailure', 'states:SendTaskSuccess'],
      })],
    });
    stepFunctionApprovalFunction.role?.attachInlinePolicy(sendTaskResultPolicy);
  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[], suffix: string = '') {
    const environment = {
      SNSHumanApprovalEmailTopic: this.approvalTopic.topicArn,
      title: this.props.title,
      message: this.props.message,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment, suffix);
  }
}
