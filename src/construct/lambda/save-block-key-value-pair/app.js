const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const { BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

exports.lambdaHandler = async (event) => {
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

const saveBlockItem = async (buffer, unprocessedItems) => {
  let params = {
    RequestItems: {},
  };
  if (buffer) {
    params.RequestItems[process.env['TextractBlockTable']] = buffer.map(Item => ({
      PutRequest: {
        Item,
      },
    }));
  } else if (unprocessedItems) {
    params.RequestItems = unprocessedItems;
  }
  try {
    const result = await ddbDocClient.send(new BatchWriteCommand(params));
    console.log(result);
    if (Object.keys(result.UnprocessedItems).length !== 0) {
      await saveBlockItem(undefined, result.UnprocessedItems);
    }
  } catch (err) {
    console.error('Error', err);
    throw err;
  }
};

const getBlock = (id, sortKey, block, expirationTime) => {
  const item = block;
  block['Pk'] = id;
  block['Sk'] = sortKey;
  block['ttl'] = expirationTime;
  return item;
};

const chunkArray = (array, chunkSize) => {
  return Array.from({ length: Math.ceil(array.length / chunkSize) },
    (_, index) => array.slice(index * chunkSize, (index + 1) * chunkSize),
  );
};

const saveKeyValueMap = async (textractResults, prefix, expirationTime) => {
  const blocks = textractResults.Blocks;

  const blockMapList = blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .map(obj => {
    return getBlock(prefix + '###blockMap', obj.id, obj.block, expirationTime);
  });

  let chunks = chunkArray(blockMapList, 25);
  for (const chunk of chunks) {
    await saveBlockItem(chunk);
  }

  const keyValueMapList = blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .filter(b => b.block.BlockType === 'KEY_VALUE_SET')
  .map(obj => {
    if (obj.block['EntityTypes'].includes('KEY')) {
      return getBlock(prefix + '###keyMap', obj.id, obj.block, expirationTime);
    } else {
      return getBlock(prefix + '###valueMap', obj.id, obj.block, expirationTime);
    }
  });
  chunks = chunkArray(keyValueMapList, 25);
  for (const chunk of chunks) {
    await saveBlockItem(chunk);
  }

  const tableMapList = blocks.map(block => {
    return {
      id: block.Id,
      block,
    };
  })
  .filter(b => b.block.BlockType === 'TABLE')
  .map(obj => {
    return getBlock(prefix + '###tableMap', obj.id, obj.block, expirationTime);
  });

  chunks = chunkArray(tableMapList, 25);
  for (const chunk of chunks) {
    await saveBlockItem(chunk);
  }

  console.log('block:' + blocks.length + ' blockMap:' + blockMapList.length + ' keyMap+valueMap:' + keyValueMapList.length + ' tableMap:' + tableMapList.length);
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
