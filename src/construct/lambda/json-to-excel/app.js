const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const xl = require('excel4node');
const path = require('path');

exports.lambdaHandler = async (event, context) => {
  const key = event.keyValuePairJson;
  const filePath = '/tmp/' + key;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await s3download(process.env['DestinationBucket'], key, filePath);

  const rawData = fs.readFileSync(filePath);
  const keyValuePairJson = JSON.parse(rawData);

  const wb = new xl.Workbook();
  const documentValueWorkSheet = wb.addWorksheet('DocumentValue');
  const documentConfidenceWorkSheet = wb.addWorksheet('DocumentConfidence');
  const pageValueWorkSheet = wb.addWorksheet('PageValue');
  const pageConfidenceWorkSheet = wb.addWorksheet('PageConfidence');

  const keys = Array.from(new Set(keyValuePairJson.map((c) => c.key))).sort();
  const pages = Array.from(new Set(keyValuePairJson.map((c) => c.page))).sort(
    (a, b) => a - b,
  );

  popularPageSheet(
    pageValueWorkSheet,
    pageConfidenceWorkSheet,
    keys,
    pages,
    keyValuePairJson,
  );
  const {
    documentConfidencePairs,
    documentValuePairs,
    documentAnswerGeometryPairs
  } = popularDocumentSheet(
    documentValueWorkSheet,
    documentConfidenceWorkSheet,
    keys,
    pages,
    keyValuePairJson,
  );

  const excelKey = event.key.replace('.pdf', '.xlsx');
  const documentConfidencePairsKey = event.key.replace('.pdf', '_DocumentConfidencePairs.json');
  const documentValuePairsKey = event.key.replace('.pdf', '_DocumentValuePairs.json');
  const documentAnswerGeometryPairsKey = event.key.replace('.pdf', '_DocumentAnswerGeometryPairsKey.json');
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


  await saveMapToS3(documentConfidencePairsKey, documentConfidencePairs);
  await saveMapToS3(documentValuePairsKey, documentValuePairs);
  await saveMapToS3(documentAnswerGeometryPairsKey, documentAnswerGeometryPairs);

  delete event.results;
  event.documentConfidencePairsKey = documentConfidencePairsKey;
  event.documentValuePairsKey = documentValuePairsKey;
  event.excelKey = excelKey;
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
  let jsonObject = {};
  pairsMap.forEach((value, key) => {
    let jsonInnerObject = {};
    value.forEach((value, key) => {
      jsonInnerObject[key] = value;
    });
    jsonObject[key] = jsonInnerObject;
  });
  return jsonObject;
};

const getDocumentPairs = (keyValuePairJson, pages) => {
  let individualKeyValue = new Map();
  let individualConfidenceValue = new Map();
  let individualAnswerGeometryValue = new Map();
  let documentValuePairs = [];
  let documentConfidencePairs = [];
  let documentAnswerGeometryPairs = [];
  for (let y = 0; y < pages.length; y++) {
    let kvs = keyValuePairJson.filter((c) => c.page === pages[y]);
    if (kvs.map((c) => c.key).some((key) => individualKeyValue.has(key))) {
      documentValuePairs.push(individualKeyValue);
      documentConfidencePairs.push(individualConfidenceValue);
      documentAnswerGeometryPairs.push(individualAnswerGeometryValue);
      individualKeyValue = new Map();
      individualConfidenceValue = new Map();
      individualAnswerGeometryValue = new Map();
    }
    kvs.map((c) => individualKeyValue.set(c.key, c.val));
    kvs.map((c) => individualConfidenceValue.set(c.key, c.valueConfidence));
    kvs.map((c) => individualAnswerGeometryValue.set(c.key, c.valGeometry));
  }
  documentValuePairs.push(individualKeyValue);
  documentConfidencePairs.push(individualConfidenceValue);
  documentAnswerGeometryPairs.push(individualAnswerGeometryValue);

  return {
    documentValuePairs,
    documentConfidencePairs,
    documentAnswerGeometryPairs
  };
};

const popularPageSheet = (
  pageValueWorkSheet,
  pageConfidenceWorkSheet,
  keys,
  pages,
  keyValuePairJson,
) => {
  for (let x = 0; x < keys.length; x++) {
    pageValueWorkSheet.cell(1, x + 1).string(keys[x]);
    pageConfidenceWorkSheet.cell(1, x + 1).string(keys[x]);
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
      }
    }
  }
};

const popularDocumentSheet = (
  documentValueWorkSheet,
  documentConfidenceWorkSheet,
  keys,
  pages,
  keyValuePairJson,
) => {
  let {
    documentValuePairs,
    documentConfidencePairs,
    documentAnswerGeometryPairs
  } = getDocumentPairs(
    keyValuePairJson,
    pages,
  );
  for (let x = 0; x < keys.length; x++) {
    documentValueWorkSheet.cell(1, x + 1).string(keys[x]);
    documentConfidenceWorkSheet.cell(1, x + 1).string(keys[x]);
  }

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < documentValuePairs.length; y++) {
      documentValueWorkSheet
      .cell(y + 2, x + 1)
      .string(documentValuePairs[y].get(keys[x]) || '');
      documentConfidenceWorkSheet
      .cell(y + 2, x + 1)
      .number(documentConfidencePairs[y].get(keys[x]) || 0);
    }
  }
  return {
    documentValuePairs,
    documentConfidencePairs,
    documentAnswerGeometryPairs
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
