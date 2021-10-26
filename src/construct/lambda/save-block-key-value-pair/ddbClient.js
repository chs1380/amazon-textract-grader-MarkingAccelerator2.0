const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
// Set the AWS Region.
const REGION = process.env.AWS_REGION; //e.g. "us-east-1"
// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: REGION });
exports.ddbClient=ddbClient;