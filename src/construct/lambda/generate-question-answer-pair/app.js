const AWS = require('aws-sdk');

const s3 = new AWS.S3();
const fs = require('fs');
const path = require('path');
const { ddbDocClient } = require('./ddbDocClient');
const {
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');

exports.lambdaHandler = async (event) => {
  const textractPrefix = event.textractPrefix;
  const key = event.key;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const keyValues = await getKeyValueRelationship(textractPrefix);
  const keyValuePairJson = key.replace('.pdf', '_keyValue.json');
  await s3.putObject({
    Bucket: process.env['DestinationBucket'],
    Key: keyValuePairJson,
    Body: JSON.stringify(keyValues),
    ContentType: 'application/json',
  }).promise();
  event.keyValuePairJson = keyValuePairJson;
  // console.log(JSON.stringify(keyValues));
  return event;
};

const concat = (x, y) => x.concat(y);

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

  items = await queryBlockItems(textractPrefix + '###tableMap');
  const tableMap = new Map();
  items.map(obj => tableMap.set(obj.Id, obj));

  items = await queryBlockItems(textractPrefix + '###blockMap');
  const blockMap = new Map();
  items.map(obj => blockMap.set(obj.Id, obj));
  console.log('blockMap' + items.length);

  let formResults = keyItems
  .map(keyItem => {
    return {
      blockId: keyItem.Id,
      keyBlock: keyItem,
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

  const isSubsetOfChoice = subset => {
    const choices = new Set(['a', 'b', 'c', 'd', 'e', 'yes', 'no']);
    for (let elem of subset) {
      if (!choices.has(elem)) {
        return false;
      }
    }
    return true;
  };

  //Handle table https://docs.aws.amazon.com/textract/latest/dg/how-it-works-selectables.html
  let tableResults = Array.from(tableMap).map(([key, value]) => ({
    key,
    value,
  }))
  .map(c => ({
    tableId: c.key,
    cells: c.value.Relationships[0].Ids.map(id => blockMap.get(id)),
  })) //Children
  .map(c => ({
    tableId: c.tableId,
    cells: c.cells.filter(cell => cell.Relationships !== null),
  })) //remove empty cell and it should be the first row and first col cell.
  .map(c => ({
    tableId: c.tableId,
    contents: c.cells.map(cell => ({
      row: cell.RowIndex,
      col: cell.ColumnIndex,
      content: blockMap.get(cell.Relationships[0].Ids.filter(c => blockMap.get(c).BlockType === 'WORD')[0]), //Cell may contain selection block and word block.
      selection: blockMap.get(cell.Relationships[0].Ids.filter(c => blockMap.get(c).BlockType === 'SELECTION_ELEMENT')[0]),
    })),
  })) // Word or Selection Element
  .map(c => ({
    tableId: c.tableId,
    contents: c.contents,
    questions: c.contents.filter(t => t.col === 1).map(t => ({
      row: t.row,
      col: t.col,
      key: t.content.Text,
      keyGeometry: t.content.Geometry,
      keyConfidence: t.content.Confidence,
      page: t.content.Page,
    })),
    possibleAnswer: c.contents.filter(t => t.row === 1).map(t => ({
      row: t.row,
      col: t.col,
      text: t.content?.Text,
    })),
    possibleAnswerText: new Set(c.contents.filter(t => t.row === 1).map(t => t.content?.Text.toLowerCase())),
  })) // First col is questions and first row is possible answer.
  .filter(c => isSubsetOfChoice(c.possibleAnswerText))
  .map(c => ({
    tableId: c.tableId,
    contents: c.contents,
    questions: c.questions,
    possibleAnswer: c.possibleAnswer,
    questionAndAnswer: c.questions.reduce((acc, curr) => {
      c.possibleAnswer.map(a => ({
        key: curr.key + '-' + a.text,
        keyGeometry: curr.keyGeometry,
        keyConfidence: curr.keyConfidence,
        page: curr.page,
        checkboxes: c.contents.filter(f => f.row === curr.row && f.col === a.col),
      }))
      .map(a => ({
        key: a.key,
        keyGeometry: a.keyGeometry,
        keyConfidence: a.keyConfidence,
        page: a.page,
        val: a.checkboxes.length === 1 && a.checkboxes[0].selection.SelectionStatus === 'SELECTED' ? 'X' : '', //single value!
        valGeometry: a.checkboxes.length === 1 ? a.checkboxes[0].selection.Geometry : null,
        valueConfidence: a.checkboxes.length === 1 ? a.checkboxes[0].selection.Confidence : 1,
      }))
      .forEach(a => acc.push(a));
      return acc;
    }, []),
  }))
  .reduce((acc, curr) => {
    curr.questionAndAnswer.forEach(a => acc.push(a));
    // acc = acc.concat(curr.questionAndAnswer);
    return acc;
  }, []);

  return [].concat(formResults).concat(tableResults);
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
