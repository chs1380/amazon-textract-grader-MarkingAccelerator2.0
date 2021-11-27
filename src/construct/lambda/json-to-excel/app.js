const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const xl = require('excel4node');
const path = require('path');

exports.lambdaHandler = async (event) => {
  let key = event.keyValuePairJson; // End with _keyValue.json
  let withAnswerSimilarity = false;
  if (!key) {
    key = event.scripts.keyValuePairJson;
    withAnswerSimilarity = true;
  }

  const keyValuePairJson = await getS3Json(process.env['DestinationBucket'], key);

  const wb = new xl.Workbook();
  const documentValueWorkSheet = wb.addWorksheet('DocumentValue');
  const documentConfidenceWorkSheet = wb.addWorksheet('DocumentConfidence');
  const documentSimilarityWorkSheet = wb.addWorksheet('DocumentAnswerSimilarity');
  const documentGeometryWorkSheet = wb.addWorksheet('DocumentAnswerGeometry');

  const pageValueWorkSheet = wb.addWorksheet('PageValue');
  const pageConfidenceWorkSheet = wb.addWorksheet('PageConfidence');
  const pageSimilarityWorkSheet = wb.addWorksheet('PageAnswerSimilarity');
  const pageGeometryWorkSheet = wb.addWorksheet('PageAnswerGeometry');

  let keys = Array.from(new Set(keyValuePairJson.map((c) => c.key))).sort();
  const pages = Array.from(new Set(keyValuePairJson.map((c) => c.page))).sort(
    (a, b) => a - b,
  );

  let nToOneMapping = event.mapping;
  let oneToNMapping;
  if (nToOneMapping) {
    nToOneMapping = new Map(Object.entries(nToOneMapping));
    console.log(nToOneMapping);
    keys = keys.map(k => nToOneMapping.has(k) ? nToOneMapping.get(k) : k);
    keys = Array.from(new Set(keys)).sort();
    console.log(keys);
    oneToNMapping = Array.from(nToOneMapping)
    .map(([key, value]) => ({
      key,
      value,
    }))
    .reduce((acc, curr) => {

      if (!acc.has(curr.value)) {
        acc.set(curr.value, []);
      }
      acc.get(curr.value).push(curr.key);
      return acc;
    }, new Map());
    console.log(oneToNMapping);
  } else {
    nToOneMapping = new Map();
    oneToNMapping = new Map();
  }

  let questionAnswerSimilarityMap = new Map();
  if (withAnswerSimilarity) {
    const similarityKeys = await Promise.all(event.matchResults
    .map(async c => ({
      question: c.question,
      similarity: await getS3Json(process.env['DestinationBucket'], c.s3Key.replace('.json', '_similarity.json')),
    })));
    // Convert to Map<question, Map<answer,similarity>>
    questionAnswerSimilarityMap = similarityKeys.reduce((acc, curr) => {
      acc.set(curr.question, new Map(Object.entries(curr.similarity)));
      return acc;
    }, new Map());
  }
  const bgStyle = wb.createStyle({
    fill: {
      type: 'pattern',
      patternType: 'solid',
      bgColor: '#ffff00',
      fgColor: '#ffff00',
    },
  });
  popularPageSheet(
    pageValueWorkSheet,
    pageConfidenceWorkSheet,
    pageSimilarityWorkSheet,
    pageGeometryWorkSheet,
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
    bgStyle,
    oneToNMapping,
  );
  const {
    documentConfidencePairs,
    documentValuePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
  } = popularDocumentSheet(
    documentValueWorkSheet,
    documentConfidenceWorkSheet,
    documentSimilarityWorkSheet,
    documentGeometryWorkSheet,
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
    bgStyle,
    oneToNMapping,
    nToOneMapping,
  );
  const documentConfidencePairsKey = key.replace('_keyValue.json', '_DocumentConfidencePairs.json');
  const documentValuePairsKey = key.replace('_keyValue.json', '_DocumentValuePairs.json');
  const documentAnswerGeometryPairsKey = key.replace('_keyValue.json', '_DocumentAnswerGeometryPairsKey.json');
  const documentSimilarityPairsKey = key.replace('_keyValue.json', '_DocumentSimilarityPairsKey.json');
  const questionAnswerSimilarityMapKey = key.replace('_keyValue.json', '_QuestionAnswerSimilarityMapKey.json');

  await saveMapToS3(documentConfidencePairsKey, documentConfidencePairs);
  await saveMapToS3(documentValuePairsKey, documentValuePairs);
  await saveMapToS3(documentAnswerGeometryPairsKey, documentAnswerGeometryPairs);
  await saveMapToS3(documentSimilarityPairsKey, documentSimilarityPairs);

  const mapReplacer = (key, value) => {
    if (value instanceof Map || value instanceof Set) {
      return [...value];
    }
    return value;
  };
  await s3.putObject({
    Bucket: process.env['DestinationBucket'],
    Key: questionAnswerSimilarityMapKey,
    Body: JSON.stringify(questionAnswerSimilarityMap, mapReplacer),
    ContentType: 'application/json',
  }).promise();

  const excelKey = key.replace('_keyValue.json', '.xlsx');
  const excelFilePath = '/tmp/' + excelKey;
  await writeExcel(wb, excelFilePath);
  const data = await readFile(excelFilePath);
  await s3
  .putObject({
    Bucket: process.env['DestinationBucket'],
    Key: excelKey,
    Body: data,
    ContentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }).promise();


  delete event.results;
  event.documentConfidencePairsKey = documentConfidencePairsKey;
  event.documentValuePairsKey = documentValuePairsKey;
  event.excelKey = excelKey;
  const regex = /\S+[a-z0-9]@[a-z0-9.]+/img;
  event.email = excelKey.match(regex)[0];
  return event;
};

const saveMapToS3 = async (key, pairsMap) => {
  await s3.putObject({
    Bucket: process.env['DestinationBucket'],
    Key: key,
    Body: JSON.stringify(convertMapToJsonObject(pairsMap)),
    ContentType: 'application/json',
  }).promise();
};

const convertMapToJsonObject = (pairsMap) => {
  let jsonObjectList = [];
  pairsMap.forEach((value) => {
    let jsonInnerObject = {};
    value.forEach((value, key) => {
      jsonInnerObject[key] = value;
    });
    jsonObjectList.push(jsonInnerObject);
  });
  return jsonObjectList;
};

const getSimilarity = (question, answer, questionAnswerSimilarityMap) => {
  //Name, Class, Student ID will not exist in standard answer.
  if (questionAnswerSimilarityMap.has(question)) {
    if (answer === '') return 0;
    const choices = new Set(['a', 'b', 'c', 'd', 'e', 'yes', 'no']);
    const last = question.split('-').pop();
    if (last && choices.has(last.toLowerCase())) {
      return (+questionAnswerSimilarityMap.get(question).get(answer) > 0.4) ? 1 : 0;
    }
    return questionAnswerSimilarityMap.get(question).get(answer);
  }
  return 0;
};
const getDocumentPairs = (keyValuePairJson, questionAnswerSimilarityMap, pages, nToOneMapping) => {
  let individualKeyValue = new Map();
  let individualConfidenceValue = new Map();
  let individualSimilarityValue = new Map();
  let individualAnswerGeometryValue = new Map();
  let documentValuePairs = [];
  let documentConfidencePairs = [];
  let documentSimilarityPairs = [];
  let documentAnswerGeometryPairs = [];

  for (let y = 0; y < pages.length; y++) {
    let kvs = keyValuePairJson.filter((c) => c.page === pages[y]);
    //Assume document page ordering is correct, then found any repeated key, then consider it is a new document.
    if (kvs.map(c => c.key).some((key) => individualKeyValue.has(key))) {
      documentValuePairs.push(individualKeyValue);
      documentConfidencePairs.push(individualConfidenceValue);
      documentSimilarityPairs.push(individualSimilarityValue);
      documentAnswerGeometryPairs.push(individualAnswerGeometryValue);
      individualKeyValue = new Map();
      individualConfidenceValue = new Map();
      individualSimilarityValue = new Map();
      individualAnswerGeometryValue = new Map();
    }

    kvs.map(c => individualKeyValue.set(c.key, c.val));
    kvs.map(c => individualConfidenceValue.set(c.key, c.valueConfidence));
    kvs.map(c => {
      let key = c.key; //script key
      if (nToOneMapping.has(c.key)) {
        key = nToOneMapping.get(c.key); //get back the answer key.
      }
      return individualSimilarityValue.set(c.key, getSimilarity(key, c.val, questionAnswerSimilarityMap));
    });
    kvs.map(c => {
      let valGeometry = c.valGeometry;
      if (valGeometry) valGeometry['page'] = y;
      individualAnswerGeometryValue.set(c.key, valGeometry);
    });
  }
  documentValuePairs.push(individualKeyValue);
  documentConfidencePairs.push(individualConfidenceValue);
  documentSimilarityPairs.push(individualSimilarityValue);
  documentAnswerGeometryPairs.push(individualAnswerGeometryValue);

  return {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
  };
};

const popularPageSheet = (
  pageValueWorkSheet,
  pageConfidenceWorkSheet,
  pageSimilarityWorkSheet,
  pageGeometryWorkSheet,
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
  bgStyle,
  oneToNMapping,
) => {
  for (let x = 0; x < keys.length; x++) {
    const question = keys[x];
    const isNotMatch = !questionAnswerSimilarityMap.has(question);
    if (isNotMatch) {
      pageValueWorkSheet.cell(1, x + 1).style(bgStyle);
      pageConfidenceWorkSheet.cell(1, x + 1).style(bgStyle);
      pageSimilarityWorkSheet.cell(1, x + 1).style(bgStyle);
      pageGeometryWorkSheet.cell(1, x + 1).style(bgStyle);
    }
    pageValueWorkSheet.cell(1, x + 1).string(question);
    pageConfidenceWorkSheet.cell(1, x + 1).string(question);
    pageSimilarityWorkSheet.cell(1, x + 1).string(question);
    pageGeometryWorkSheet.cell(1, x + 1).string(question);
  }

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < pages.length; y++) {
      let value, valueConfidence, similarity, data;
      if (oneToNMapping.has(keys[x])) {
        const duplicatedKeys = oneToNMapping.get(keys[x]);
        // no need megre as only key mapping must only has one value!
        data = duplicatedKeys.map(k =>
          keyValuePairJson.filter(
            c => c.page === pages[y] && c.key === k,
          )[0])
        .filter(c => c !== undefined)[0];
      } else {
        data = keyValuePairJson.filter(
          c => c.page === pages[y] && c.key === keys[x],
        )[0];
      }
      if (data) {
        value = data.val;
        valueConfidence = data.valueConfidence;
        similarity = getSimilarity(keys[x], data.val, questionAnswerSimilarityMap);
        pageValueWorkSheet.cell(y + 2, x + 1).string(value);
        pageConfidenceWorkSheet.cell(y + 2, x + 1).number(valueConfidence);
        pageSimilarityWorkSheet.cell(y + 2, x + 1).number(similarity);
        pageGeometryWorkSheet.cell(y + 2, x + 1).string(JSON.stringify(data.valGeometry));
      }
    }
  }
};

const popularDocumentSheet = (
  documentValueWorkSheet,
  documentConfidenceWorkSheet,
  documentSimilarityWorkSheet,
  documentGeometryWorkSheet,
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
  bgStyle,
  oneToNMapping,
  nToOneMapping,
) => {
  let {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
  } = getDocumentPairs(
    keyValuePairJson,
    questionAnswerSimilarityMap,
    pages,
    nToOneMapping,
  );
  for (let x = 0; x < keys.length; x++) {
    const question = keys[x];
    const isNotMatch = !questionAnswerSimilarityMap.has(question);
    if (isNotMatch) {
      documentValueWorkSheet.cell(1, x + 1).style(bgStyle);
      documentSimilarityWorkSheet.cell(1, x + 1).style(bgStyle);
      documentConfidenceWorkSheet.cell(1, x + 1).style(bgStyle);
      documentGeometryWorkSheet.cell(1, x + 1).style(bgStyle);
    }
    documentValueWorkSheet.cell(1, x + 1).string(question);
    documentSimilarityWorkSheet.cell(1, x + 1).string(question);
    documentConfidenceWorkSheet.cell(1, x + 1).string(question);
    documentGeometryWorkSheet.cell(1, x + 1).string(question);
  }

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < documentValuePairs.length; y++) {
      let value, valueConfidence, similarity, geometry;
      if (oneToNMapping.has(keys[x])) {
        const duplicatedKeys = oneToNMapping.get(keys[x]);
        value = duplicatedKeys.map(k => documentValuePairs[y].get(k) || '').join('');
        similarity = Math.max(...duplicatedKeys.map(k => documentSimilarityPairs[y].has(k) ? documentSimilarityPairs[y].get(k) : 0));
        valueConfidence = Math.max(...duplicatedKeys.map(k => documentConfidencePairs[y].get(k) || 0));
        geometry = duplicatedKeys.map(k => documentAnswerGeometryPairs[y].get(k)).filter(k => k !== undefined)[0];
      } else {
        value = documentValuePairs[y].get(keys[x]) || '';
        similarity = documentSimilarityPairs[y].has(keys[x]) ? documentSimilarityPairs[y].get(keys[x]) : 0;
        valueConfidence = documentConfidencePairs[y].get(keys[x]) || 0;
        geometry = documentAnswerGeometryPairs[y].get(keys[x]) || {};
      }
      documentValueWorkSheet.cell(y + 2, x + 1).string(value);
      documentSimilarityWorkSheet.cell(y + 2, x + 1).number(similarity);
      documentConfidenceWorkSheet.cell(y + 2, x + 1).number(valueConfidence);
      documentGeometryWorkSheet.cell(y + 2, x + 1).string(JSON.stringify(geometry));
    }
  }
  return {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
  };
};

const writeExcel = (workbook, filePath) => {
  return new Promise((resolve, reject) => {
    workbook.write(filePath, (err, stats) => {
      if (err) {
        return reject(err);
      } else {
        return resolve(stats); // Prints out an instance of a node.js fs.Stats object
      }
    });
  });
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

const getS3Json = async (bucketName, key) => {
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(bucketName, key, filePath);
  const rawData = fs.readFileSync(filePath);
  return JSON.parse(rawData);
};
