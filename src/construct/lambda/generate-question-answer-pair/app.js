const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const {
  GetCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

exports.lambdaHandler = async (event, context) => {
  const textractPrefix = event.textractPrefix;
  const key = event.key;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const keyValues = await getKeyValueRelationship(textractPrefix);
  console.log(keyValues);
  const keyValuePairJson = key.replace('.json', '_keyValue.json');
  await s3.putObject({
    Bucket: process.env['TextractBucket'],
    Key: keyValuePairJson,
    Body: JSON.stringify(keyValues),
    ContentType: 'application/json',
  }).promise();
  event.keyValuePairJson = keyValuePairJson;

  return event;
};

const concat = (x, y) =>
  x.concat(y);

const findValueBlock = (keyBlock, valueMap) => {
  let valueBlock;
  if (keyBlock.Relationships) {
    valueBlock = keyBlock.Relationships
    .filter(relationship => relationship.Type === 'VALUE')
    .map(relationship => relationship.Ids)
    .reduce(concat, [])
    .map(id => valueMap.get(id))
    .reduce(concat, []);
    return valueBlock[0];
  }
  return valueBlock;
};

const getText = (result, blockMap) => {
  let text = '';
  if (result && result.Relationships !== undefined) {
    const blocks = result.Relationships
    .filter(r => r['Type'] === 'CHILD')
    .map(relationship =>
      relationship.Ids.map(id => blockMap.get(id)),
    ).reduce(concat, []);
    text += blocks.filter(b => b.BlockType === 'WORD')
    .reduce((acc, item) => acc + ' ' + item.Text, '');
    text += blocks.filter(b => b.BlockType === 'SELECTION_ELEMENT' && b.SelectionStatus === 'SELECTED')
    .reduce((acc, item) => acc + 'X ', '');
  }
  return text.trim();
};
const getKeyValueRelationship = async (textractPrefix) => {
  const items = await queryBlockItems(textractPrefix+ '###keyMap' );
  return Array.from(keyMap.keys())
  .map(blockId => {
    return {
      blockId: blockId,
      keyBlock: keyMap.get(blockId),
    };
  })
  .map(c => {
    return {
      blockId: c.blockId,
      keyBlock: c.keyBlock,
      valueBlock: findValueBlock(c.keyBlock, valueMap),
    };
  })
  .map(c => {
    return {
      key: getText(c.keyBlock, blockMap),
      val: getText(c.valueBlock, blockMap),
      keyConfidence: c.keyBlock.Confidence,
      valueConfidence: c.valueBlock.Confidence,
      page: c.keyBlock.Page,
    };
  })
  .filter(c => c.key !== '');
};

const getBlockItem = async (key, sortKey) => {
  const params = {
    TableName: process.env['TextractBlockTable'],
    Key: {
      Key: key,
      SortKey: sortKey,
    },
  };
  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    return data.Item;
  } catch (err) {
    console.log('Error', err);
  }
};

const queryBlockItems = async (key) => {
  const params = {
    TableName: process.env['TextractBlockTable'],
    ExpressionAttributeValues: {
      ':s': key,
    },
    // Specifies the values that define the range of the retrieved items. In this case, items in Season 2 before episode 9.
    KeyConditionExpression: '#uu = :s',
    ExpressionAttributeNames: { '#uu': "Key" }
  };
  try {
    const data = await ddbDocClient.send(new QueryCommand(params));
    console.log(data);
    return data.Item;
  } catch (err) {
    console.log('Error', err);
  }
};
