const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');

exports.lambdaHandler = async (event, context) => {
  const key = event.resultKey;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(process.env['TextractBucket'], key, filePath);

  const rawData = fs.readFileSync(filePath);
  const textractResults = JSON.parse(rawData);

  const {
    blockMap,
    keyMap,
    valueMap,
  } = getKeyValueMap(textractResults);
  const keyValues = getKeyValueRelationship(keyMap, blockMap, valueMap);
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
  let valueBlock = undefined;
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
const getKeyValueRelationship = (keyMap, blockMap, valueMap) => {
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


const s3download = (bucketName, keyName, localDest) => {
  if (typeof localDest == 'undefined') {
    localDest = keyName;
  }
  let params = {
    Bucket: bucketName,
    Key: keyName,
  };
  let file = fs.createWriteStream(localDest);

  return new Promise((resolve, reject) => {
    s3.getObject(params).createReadStream()
    .on('end', () => {
      return resolve();
    })
    .on('error', (error) => {
      return reject(error);
    }).pipe(file);
  });
};
