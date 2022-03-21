const { awscdk } = require('projen');
const project = new awscdk.AwsCdkTypeScriptApp({
  authorName: 'Cyrus Wong',
  authorEmail: 'cywong@vtc.edu.hk',
  repository: 'https://github.com/wongcyrus/amazon-textract-grader',
  cdkVersion: '2.17.0',
  defaultReleaseBranch: 'main',
  name: 'amazon-textract-grader',
  context: {
    namePrefix: 'grader',
    email: process.env.email ?? 'dummy@email.com',
  },
  deps: [

  ], /* Which AWS CDK modules (those that start with "@aws-cdk/") this app uses. */
  keywords: [
    'cdk',
    'textract',
    'stepfunction',
  ],
  // deps: [],                    /* Runtime dependencies of this module. */
  // description: undefined,      /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],                 /* Build dependencies for this module. */
  // packageName: undefined,      /* The "name" in package.json. */
  // release: undefined,          /* Add release management to this project. */
});
project.addTask('deploy-hotswap', {
  exec: 'cdk deploy --hotswap --require-approval never',
});
project.gitignore.addPatterns('cdk.json');

project.synth();