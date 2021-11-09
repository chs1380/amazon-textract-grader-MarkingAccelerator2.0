const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

exports.lambdaHandler = async(event) => {
  const key = event.key;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(process.env['SourceBucket'], key, filePath);

  const rawData = fs.readFileSync(filePath);
  const textractResults = JSON.parse(rawData);

  //expire the items after 1 day.
  const SECONDS_IN_AN_HOUR = 60 * 60;
  const secondsSinceEpoch = Math.round(Date.now() / 1000);
  const expirationTime = secondsSinceEpoch + 24 * SECONDS_IN_AN_HOUR;
  await saveKeyValueMap(textractResults, event.prefix, expirationTime);

  return event;
};

const saveBlockItem = async(id, sortKey, block, expirationTime) => {
  const item = block;
  block['Pk'] = id;
  block['Sk'] = sortKey;
  block['ttl'] = expirationTime;
  const params = {
    TableName: process.env['TextractBlockTable'],
    Item: item
  };
  try {
    return await ddbDocClient.send(new PutCommand(params));
  }
  catch (err) {
    console.error('Error', err);
    throw err;
  }
};


const saveKeyValueMap = async(textractResults, prefix, expirationTime) => {
  const blocks = textractResults.Blocks;
  const r = await Promise.all(blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .map(async(obj) => {
    return await saveBlockItem(prefix + '###blockMap', obj.id, obj.block, expirationTime);
  }));

  const l = await Promise.all(blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .filter(b => b.block.BlockType === 'KEY_VALUE_SET')
  .map(async(obj) => {
    if (obj.block['EntityTypes'].includes('KEY')) {
      return await saveBlockItem(prefix + '###keyMap', obj.id, obj.block, expirationTime);
    }
    else {
      return await saveBlockItem(prefix + '###valueMap', obj.id, obj.block, expirationTime);
    }
  }));

  await Promise.all(blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .filter(b => b.block.BlockType === 'TABLE')
  .map(async(obj) => {
    return await saveBlockItem(prefix + '###tableMap', obj.id, obj.block, expirationTime);
  }));
  console.log("blockMap:" + r.length);
  console.log("keyMap+valueMap:" + l.length);
};

const s3download = async(bucketName, keyName, localDest) => {
  if (typeof localDest == 'undefined') {
    localDest = keyName;
  }
  let params = {
    Bucket: bucketName,
    Key: keyName,
  };
  const data = await s3.getObject(params).promise();
  fs.writeFileSync(localDest, data.Body);
};
