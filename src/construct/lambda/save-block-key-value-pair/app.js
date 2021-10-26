const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

exports.lambdaHandler = async (event, context) => {
  const key = event.key;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(process.env['SourceBucket'], key, filePath);

  const rawData = fs.readFileSync(filePath);
  const textractResults = JSON.parse(rawData);

  const {
    blockMap,
    keyMap,
    valueMap,
  } = getKeyValueMap(textractResults);

  const SECONDS_IN_AN_HOUR = 60 * 60;
  const secondsSinceEpoch = Math.round(Date.now() / 1000);
  const expirationTime = secondsSinceEpoch + 24 * SECONDS_IN_AN_HOUR;

  await saveKeyValueMap(event.prefix + '_blockMap', blockMap, expirationTime);
  await saveKeyValueMap(event.prefix + '_keyMap', keyMap, expirationTime);
  await saveKeyValueMap(event.prefix + '_valueMap', valueMap, expirationTime);

  return event;
};


const getKeyValueMap = textractResults => {
  const blocks = textractResults.Blocks;

  const blockMap = blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .reduce((map, obj) => {
    map.set(obj.id, obj.block);
    return map;
  }, new Map());

  const {
    keyMap,
    valueMap,
  } = blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .filter(b => b.block.BlockType === 'KEY_VALUE_SET')
  .reduce((map, obj) => {
    if (obj.block['EntityTypes'].includes('KEY')) {
      map.keyMap.set(obj.id, obj.block);
    } else {
      map.valueMap.set(obj.id, obj.block);
    }
    return map;
  }, {
    keyMap: new Map(),
    valueMap: new Map(),
  });
  return {
    blockMap,
    keyMap,
    valueMap,
  };
};

const s3download = async (bucketName, keyName, localDest) => {
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

const saveKeyValueMap = async (prefix, kvMap, expirationTime) => {
  await Promise.all(Array.from(kvMap).map(async ([key, value]) => {
    await saveBlockItem(prefix + '###' + key, value, expirationTime);
  }));
};

const saveBlockItem = async (id, block, expirationTime) => {
  const item = block;
  block['Key'] = id;
  block['ttl'] = expirationTime;
  const params = {
    TableName: process.env['TextractBlockTable'],
    Item: item,
  };
  try {
    return await ddbDocClient.send(new PutCommand(params));
  } catch (err) {
    console.log('Error', err);
  }
};
