console.log('Loading function');
const AWS = require('aws-sdk');
exports.lambdaHandler = (event, context, callback) => {
  console.log('event= ' + JSON.stringify(event));
  console.log('context= ' + JSON.stringify(context));

  const executionContext = event.ExecutionContext;
  console.log('executionContext= ' + executionContext);

  const executionName = executionContext.Execution.Name;
  console.log('executionName= ' + executionName);

  const statemachineName = executionContext.StateMachine.Name;
  console.log('statemachineName= ' + statemachineName);

  const taskToken = executionContext.Task.Token;
  console.log('taskToken= ' + taskToken);

  const apigwEndpint = event.APIGatewayEndpoint;
  console.log('apigwEndpint = ' + apigwEndpint);

  const approveEndpoint = apigwEndpint + '/?action=approve&ex=' + executionName + '&sm=' + statemachineName + '&taskToken=' + encodeURIComponent(taskToken);
  console.log('approveEndpoint= ' + approveEndpoint);

  const rejectEndpoint = apigwEndpint + '/?action=reject&ex=' + executionName + '&sm=' + statemachineName + '&taskToken=' + encodeURIComponent(taskToken);
  console.log('rejectEndpoint= ' + rejectEndpoint);

  const emailSnsTopic = process.env.SNSHumanApprovalEmailTopic;
  console.log('emailSnsTopic= ' + emailSnsTopic);

  const message = event.Message ?? '';

  let emailMessage = 'Welcome! \n\n';
  emailMessage += process.env.message + message + '\n\n';
  emailMessage += 'This is an email requiring an approval for a step functions execution. \n\n';
  emailMessage += 'Please check the following information and click "Approve" link if you want to approve. \n\n';
  emailMessage += 'Execution Name -> ' + executionName + '\n\n';
  emailMessage += 'Approve ' + approveEndpoint + '\n\n';
  emailMessage += 'Reject ' + rejectEndpoint + '\n\n';
  emailMessage += 'Thanks for using Step functions!';

  const subject = event.Subject ?? '';

  const sns = new AWS.SNS();
  let params = {
    Message: emailMessage,
    Subject: (process.env.title ? process.env.title : 'Required approval from AWS Step Functions: ') + subject,
    TopicArn: emailSnsTopic,
  };

  const email = event.Email;
  if (email) {
    params['MessageAttributes'] = {
      'email': {
        'DataType': 'String',
        'StringValue': email,
      },
    };
  }
  sns.publish(params)
  .promise()
  .then(function (data) {
    console.log('MessageID is ' + data.MessageId);
    callback(null);
  }).catch(
    function (err) {
      console.error(err, err.stack);
      callback(err);
    });
};