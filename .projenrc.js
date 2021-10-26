const { AwsCdkTypeScriptApp } = require('projen');
const project = new AwsCdkTypeScriptApp({
  cdkVersion: '1.129.0',
  defaultReleaseBranch: 'main',
  name: 'amazon-textract-grader',
  cdkDependencies: [
    '@aws-cdk/aws-s3',
    '@aws-cdk/aws-dynamodb',
    '@aws-cdk/aws-lambda',
    '@aws-cdk/aws-sns',
    '@aws-cdk/aws-sns-subscriptions',
    '@aws-cdk/aws-iam',
    '@aws-cdk/aws-stepfunctions',
    '@aws-cdk/aws-stepfunctions-tasks',
  ], /* Which AWS CDK modules (those that start with "@aws-cdk/") this app uses. */
  // deps: [],                    /* Runtime dependencies of this module. */
  // description: undefined,      /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],                 /* Build dependencies for this module. */
  // packageName: undefined,      /* The "name" in package.json. */
  // release: undefined,          /* Add release management to this project. */
});
project.addTask('deploy-hotswap', {
  exec: 'cdk deploy --hotswap --require-approval never',
});
project.synth();