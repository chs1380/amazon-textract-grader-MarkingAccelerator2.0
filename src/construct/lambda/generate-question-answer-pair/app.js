const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const {
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
    Bucket: process.env['DestinationBucket'],
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
  if (keyBlock.Relationships) {
    const valueBlock = keyBlock.Relationships
    .filter(relationship => relationship.Type === 'VALUE')
    .map(relationship => relationship.Ids)
    .reduce(concat, [])
    .map(id => valueMap.get(id))
    .reduce(concat, []);
    return valueBlock[0];
  }
};

const getText = (result, blockMap) => {
  let text = '';
  if (result && result.Relationships && result.Relationships.length > 0) {
    const blocks = result.Relationships
    .filter(r => r['Type'] === 'CHILD')
    .map(relationship => relationship.Ids.map(id => blockMap.get(id)))
    .reduce(concat, []);
    text += blocks.filter(b => b.BlockType === 'WORD')
    .reduce((acc, item) => acc + ' ' + item.Text, '');
    text += blocks.filter(b => b.BlockType === 'SELECTION_ELEMENT' && b.SelectionStatus === 'SELECTED')
    .reduce((acc) => acc + 'X ', '');
  }
  return text.trim();
};
const getKeyValueRelationship = async (textractPrefix) => {
  let keyItems = await queryBlockItems(textractPrefix + '###keyMap');

  let items = await queryBlockItems(textractPrefix + '###valueMap');
  const valueMap = new Map();
  items.map(obj => valueMap.set(obj.Id, obj));

  items = await queryBlockItems(textractPrefix + '###blockMap');
  const blockMap = new Map();
  items.map(obj => blockMap.set(obj.Id, obj));
  console.log('blockMap' + items.length);

  return keyItems
  .map(keyitem => {
    return {
      blockId: keyitem.Id,
      keyBlock: keyitem,
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
      keyGeometry: c.keyBlock.Geometry,
      valGeometry: c.valueBlock.Geometry,
      keyConfidence: c.keyBlock.Confidence,
      valueConfidence: c.valueBlock.Confidence,
      page: c.keyBlock.Page,
    };
  })
  .filter(c => c.key !== '');
};


const queryBlockItems = async (key, params, allData) => {
  if (!params) {
    params = {
      TableName: process.env['TextractBlockTable'],
      ExpressionAttributeValues: {
        ':s': key,
      },
      KeyConditionExpression: 'Pk = :s',
    };
    allData = [];
  }

  try {
    const data = await ddbDocClient.send(new QueryCommand(params));
    if (data['Items'].length > 0) {
      allData = [...allData, ...data['Items']];
    }
    if (data.LastEvaluatedKey) {
      params.ExclusiveStartKey = data.LastEvaluatedKey;
      return await queryBlockItems(key, params, allData);
    } else {
      return allData;
    }
  } catch (err) {
    console.log('Error', err);
  }
};
