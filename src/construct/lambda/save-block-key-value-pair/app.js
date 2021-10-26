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

  await saveKeyValueMap(event.key+"_blockMap",blockMap);
  await saveKeyValueMap(event.key+"_keyMap",keyMap);
  await saveKeyValueMap(event.key+"_valueMap",valueMap);
  // const keyValues = getKeyValueRelationship(keyMap, blockMap, valueMap);
  // console.log(keyValues);
  // const keyValuePairJson = key + '_keyValue.json';
  // await s3.putObject({
  //   Bucket: process.env['SourceBucket'],
  //   Key: keyValuePairJson,
  //   Body: JSON.stringify(keyValues),
  //   ContentType: 'application/json',
  // }).promise();
  // event.keyValuePairJson = keyValuePairJson;
  return event;
};

// const concat = (x, y) =>
//   x.concat(y);
//
// const findValueBlock = (keyBlock, valueMap) => {
//   let valueBlock = undefined;
//   if (keyBlock.Relationships) {
//     valueBlock = keyBlock.Relationships
//     .filter(relationship => relationship.Type === 'VALUE')
//     .map(relationship => relationship.Ids)
//     .reduce(concat, [])
//     .map(id => valueMap.get(id))
//     .reduce(concat, []);
//     return valueBlock[0];
//   }
//   return valueBlock;
// };

// const getText = (result, blockMap) => {
//   let text = '';
//   if (result && result.Relationships) {
//     const blocks = result.Relationships
//     .filter(r => r['Type'] === 'CHILD')
//     .map(relationship =>
//       relationship.Ids.map(id => blockMap.get(id)),
//     ).reduce(concat, []);
//     text += blocks.filter(b => b.BlockType === 'WORD')
//     .reduce((acc, item) => acc + ' ' + item.Text, '');
//     text += blocks.filter(b => b.BlockType === 'SELECTION_ELEMENT' && b.SelectionStatus === 'SELECTED')
//     .reduce((acc, item) => acc + 'X ', '');
//   }
//   return text.trim();
// };
// const getKeyValueRelationship = (keyMap, blockMap, valueMap) => {
//   return Array.from(keyMap.keys())
//   .map(blockId => {
//     return {
//       blockId: blockId,
//       keyBlock: keyMap.get(blockId),
//     };
//   })
//   .map(c => {
//     return {
//       blockId: c.blockId,
//       keyBlock: c.keyBlock,
//       valueBlock: findValueBlock(c.keyBlock, valueMap),
//     };
//   })
//   .map(c => {
//     return {
//       key: getText(c.keyBlock, blockMap),
//       val: getText(c.valueBlock, blockMap),
//       keyConfidence: c.keyBlock.Confidence,
//       valueConfidence: c.valueBlock.Confidence,
//       page: c.keyBlock.Page,
//     };
//   })
//   .filter(c => c.key !== '');
// };

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

const saveKeyValueMap = async (prefix, kvMap) => {
  await Promise.all(kvMap.map(async (value, key) => {
    await saveBlockItem(prefix + '###' + key, value);
  }));
};

const saveBlockItem = async (id, block) => {
  const item = block;
  block['key'] = id;
  const params = {
    TableName: process.env['TextractBlockTable'],
    Item: item,
  };
  try {
    const data = await ddbDocClient.send(new PutCommand(params));
    console.log('Success - item added or updated', data);
    return data;
  } catch (err) {
    console.log('Error', err);
  }
};
