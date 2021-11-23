import { LambdaRestApi } from '@aws-cdk/aws-apigateway';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { ILayerVersion } from '@aws-cdk/aws-lambda';
import { Topic } from '@aws-cdk/aws-sns';
import { EmailSubscription } from '@aws-cdk/aws-sns-subscriptions';
import * as sfn from '@aws-cdk/aws-stepfunctions';
import { Choice, IntegrationPattern, StateMachine } from '@aws-cdk/aws-stepfunctions';
import * as tasks from '@aws-cdk/aws-stepfunctions-tasks';
import { TaskInput } from '@aws-cdk/aws-stepfunctions/lib/input';
import { Construct, Duration } from '@aws-cdk/core';
import { LambdaHelper } from './lib/lambda-helper';

export interface HumanApprovalStateMachineConstructProps {
  url: string;
}

export class HumanApprovalStateMachineConstruct extends Construct {
  private lambdaHelper: LambdaHelper;
  public readonly approvalTopic: Topic;
  public readonly stateMachine: StateMachine;

  constructor(scope: Construct, id: string, props: HumanApprovalStateMachineConstructProps) {
    super(scope, id);
    this.lambdaHelper = new LambdaHelper(this);
    console.log(props.url);
    this.approvalTopic = new Topic(this, 'Topic', {});
    this.approvalTopic.addSubscription(new EmailSubscription('cywong@vtc.edu.hk'));

    const stepFunctionApprovalFunction = this.getLambdaFunction('stepfunction-approval', []);
    const lambdaRestApi = new LambdaRestApi(this, 'ApprovalApi', {
      handler: stepFunctionApprovalFunction,
    });

    const stepFunctionApprovalEmailFunction = this.getLambdaFunction('stepfunction-approval-email', []);
    this.approvalTopic.grantPublish(stepFunctionApprovalEmailFunction);

    const stepFunctionApprovalEmailTask = new tasks.LambdaInvoke(this, 'stepFunctionApprovalEmailTask', {
      lambdaFunction: stepFunctionApprovalEmailFunction,
      payload: TaskInput.fromObject({
        ExecutionContext: sfn.JsonPath.entireContext,
        APIGatewayEndpoint: lambdaRestApi.url,
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

    stepFunctionApprovalFunction.role?.addToPolicy(new PolicyStatement({
      resources: ['*'],
      actions: ['states:SendTaskFailure', 'states:SendTaskSuccess'],
    }));
  }

  private getLambdaFunction(assetPath: string, layers: ILayerVersion[], suffix: string = '') {
    const environment = {
      SNSHumanApprovalEmailTopic: this.approvalTopic.topicArn,
    };
    return this.lambdaHelper.getLambdaFunction(assetPath, layers, environment, suffix);
  }
}
