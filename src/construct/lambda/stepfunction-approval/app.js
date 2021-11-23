const AWS = require('aws-sdk');
const stepfunctions = new AWS.StepFunctions();

const redirectToStepFunctions = (lambdaArn, stateMachineName, executionName, callback) => {
  const lambdaArnTokens = lambdaArn.split(':');
  const partition = lambdaArnTokens[1];
  const region = lambdaArnTokens[3];
  const accountId = lambdaArnTokens[4];

  console.log('partition=' + partition);
  console.log('region=' + region);
  console.log('accountId=' + accountId);

  const executionArn = 'arn:' + partition + ':states:' + region + ':' + accountId + ':execution:' + stateMachineName + ':' + executionName;
  console.log('executionArn=' + executionArn);

  const url = 'https://console.aws.amazon.com/states/home?region=' + region + '#/executions/details/' + executionArn;
  callback(null, {
    statusCode: 302,
    headers: {
      Location: url,
    },
  });
};

exports.lambdaHandler = (event, context, callback) => {
  console.log('Event= ' + JSON.stringify(event));
  const action = event.queryStringParameters.action;
  const taskToken = event.queryStringParameters.taskToken;
  const stateMachineName = event.queryStringParameters.sm;
  const executionName = event.queryStringParameters.ex;

  let message = '';

  if (action === 'approve') {
    message = { 'Status': 'Approved' };
  } else if (action === 'reject') {
    message = { 'Status': 'Rejected' };
  } else {
    console.error('Unrecognized action. Expected: approve, reject.');
    callback({ 'Status': 'Failed to process the request. Unrecognized Action.' });
  }

  stepfunctions.sendTaskSuccess({
    output: JSON.stringify(message),
    taskToken: taskToken,
  })
  .promise()
  .then(() => {
    redirectToStepFunctions(context.invokedFunctionArn, stateMachineName, executionName, callback);
  }).catch(err => {
    console.error(err, err.stack);
    callback(err);
  });
};