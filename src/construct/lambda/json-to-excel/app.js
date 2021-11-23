const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const xl = require('excel4node');
const path = require('path');

exports.lambdaHandler = async(event) => {
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

  const pageValueWorkSheet = wb.addWorksheet('PageValue');
  const pageConfidenceWorkSheet = wb.addWorksheet('PageConfidence');
  const pageSimilarityWorkSheet = wb.addWorksheet('PageAnswerSimilarity');

  const keys = Array.from(new Set(keyValuePairJson.map((c) => c.key))).sort();
  const pages = Array.from(new Set(keyValuePairJson.map((c) => c.page))).sort(
    (a, b) => a - b,
  );

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

  popularPageSheet(
    pageValueWorkSheet,
    pageConfidenceWorkSheet,
    pageSimilarityWorkSheet,
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
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
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
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
  return event;
};

const saveMapToS3 = async(key, pairsMap) => {
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
    const last = question.split("-").pop();
    if (last && choices.has(last.toLowerCase())) {
      return (+questionAnswerSimilarityMap.get(question).get(answer) > 0.4) ? 1 : 0;
    }
    return questionAnswerSimilarityMap.get(question).get(answer);
  }
  return 0;
};
const getDocumentPairs = (keyValuePairJson, questionAnswerSimilarityMap, pages) => {
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
    if (kvs.map((c) => c.key).some((key) => individualKeyValue.has(key))) {
      documentValuePairs.push(individualKeyValue);
      documentConfidencePairs.push(individualConfidenceValue);
      documentSimilarityPairs.push(individualSimilarityValue);
      documentAnswerGeometryPairs.push(individualAnswerGeometryValue);
      individualKeyValue = new Map();
      individualConfidenceValue = new Map();
      individualSimilarityValue = new Map();
      individualAnswerGeometryValue = new Map();
    }

    kvs.map((c) => individualKeyValue.set(c.key, c.val));
    kvs.map((c) => individualConfidenceValue.set(c.key, c.valueConfidence));
    kvs.map((c) => individualSimilarityValue.set(c.key, getSimilarity(c.key, c.val, questionAnswerSimilarityMap)));
    kvs.map((c) => individualAnswerGeometryValue.set(c.key, c.valGeometry));
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
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
) => {
  for (let x = 0; x < keys.length; x++) {
    pageValueWorkSheet.cell(1, x + 1).string(keys[x]);
    pageConfidenceWorkSheet.cell(1, x + 1).string(keys[x]);
    pageSimilarityWorkSheet.cell(1, x + 1).string(keys[x]);
  }

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < pages.length; y++) {
      let data = keyValuePairJson.filter(
        (c) => c.page === pages[y] && c.key === keys[x],
      );
      if (data.length === 1) {
        pageValueWorkSheet.cell(y + 2, x + 1).string(data[0].val);
        pageConfidenceWorkSheet
        .cell(y + 2, x + 1)
        .number(data[0].valueConfidence);
        pageSimilarityWorkSheet
        .cell(y + 2, x + 1)
        .number(getSimilarity(data[0].key, data[0].val, questionAnswerSimilarityMap));
      }
    }
  }
};

const popularDocumentSheet = (
  documentValueWorkSheet,
  documentConfidenceWorkSheet,
  documentSimilarityWorkSheet,
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
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
  );
  for (let x = 0; x < keys.length; x++) {
    documentValueWorkSheet.cell(1, x + 1).string(keys[x]);
    documentSimilarityWorkSheet.cell(1, x + 1).string(keys[x]);
    documentConfidenceWorkSheet.cell(1, x + 1).string(keys[x]);
  }

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < documentValuePairs.length; y++) {
      documentValueWorkSheet
      .cell(y + 2, x + 1)
      .string(documentValuePairs[y].get(keys[x]) || '');

      documentSimilarityWorkSheet
      .cell(y + 2, x + 1)
      .number(documentSimilarityPairs[y].has(keys[x]) ? documentSimilarityPairs[y].get(keys[x]) : 0);

      documentConfidenceWorkSheet
      .cell(y + 2, x + 1)
      .number(documentConfidencePairs[y].get(keys[x]) || 0);
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
      }
      else {
        return resolve(stats); // Prints out an instance of a node.js fs.Stats object
      }
    });
  });
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

const getS3Json = async(bucketName, key) => {
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(bucketName, key, filePath);
  const rawData = fs.readFileSync(filePath);
  return JSON.parse(rawData);
};
