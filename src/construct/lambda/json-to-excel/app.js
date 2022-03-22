const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const { promisify } = require('util');
const readFile = promisify(fs.readFile);
const xl = require('excel4node');
const path = require('path');

const expires = 604800; //7 days

exports.lambdaHandler = async (event) => {
  let key = event.keyValuePairJson; // End with _keyValue.json
  let withAnswerSimilarity = false;
  if (!key) {
    key = event.scripts.keyValuePairJson;
    withAnswerSimilarity = true;
  }

  const imagePrefix = key.replace('_keyValue.json', '/');

  const wb = new xl.Workbook();
  const documentSheet = getSheets(wb, 'Document');
  const pageSheet = getSheets(wb, 'Page');

  const keyValuePairJson = await getS3Json(process.env['DestinationBucket'], key);
  let keys = Array.from(new Set(keyValuePairJson.map((c) => c.key))).sort();
  const pages = Array.from(new Set(keyValuePairJson.map((c) => c.page))).sort(
    (a, b) => a - b,
  );

  let nToOneMapping = new Map();
  let oneToNMapping = new Map();
  if (event.mapping) {
    const __ret = populateMapping(nToOneMapping, keys, oneToNMapping, event);
    nToOneMapping = __ret.nToOneMapping;
    keys = __ret.keys;
    oneToNMapping = __ret.oneToNMapping;
  }

  let questionAnswerSimilarityMap = new Map();
  if (withAnswerSimilarity) {
    questionAnswerSimilarityMap = await populateAnswerSimilarity(event);
  }

  popularPageSheet(
    pageSheet,
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
    oneToNMapping,
    imagePrefix,
  );
  const pairs = popularDocumentSheet(
    documentSheet,
    keys,
    pages,
    keyValuePairJson,
    questionAnswerSimilarityMap,
    oneToNMapping,
    nToOneMapping,
    imagePrefix,
  );

  const getPairKey = property => key.replace('_keyValue.json', `_${property}.json`);
  for (const property in pairs) {
    const documentConfidencePairsKey = getPairKey(property);
    await saveMapToS3(documentConfidencePairsKey, pairs[property]);
  }
  const documentConfidencePairsKey = getPairKey('documentConfidencePairs');
  const questionAnswerSimilarityMapKey = getPairKey('questionAnswerSimilarityMap');
  const documentValuePairsKey = getPairKey('documentValuePairs');

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
  let subject = event.scripts ? event.scripts.key : event.key;
  event.subject = subject.replace(event.email + '/', '');
  const downloadReport = getS3PreSignedUrl(process.env['DestinationBucket'], excelKey, expires);
  event.message = `Download ${event.subject}: ` + downloadReport;
  return event;
};

const getSheets = (wb, prefix) => {
  const sheet = {};
  sheet.workbook = wb;
  sheet.value = wb.addWorksheet(prefix + 'Value', {});
  sheet.confidence = wb.addWorksheet(prefix + 'Confidence', {});
  sheet.similarity = wb.addWorksheet(prefix + 'AnswerSimilarity', {});
  sheet.geometry = wb.addWorksheet(prefix + 'AnswerGeometry', {});
  sheet.image = wb.addWorksheet(prefix + 'AnswerImage', {});
  return sheet;
};

const populateMapping = (nToOneMapping, keys, oneToNMapping, event) => {
  oneToNMapping = Object.entries(event.mapping)
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

  nToOneMapping = Object.entries(event.mapping)
  .map(([key, value]) => ({
    key,
    value,
  }))
  .reduce((acc, curr) => {
    if (!acc.has(curr.key)) {
      acc.set(curr.key, curr.value);
    }
    return acc;
  }, new Map());
  keys = keys.map(c=>{
    if(nToOneMapping.has(c)) return nToOneMapping.get(c);
    return c;
  });
  keys = Array.from(new Set(keys)).sort();
  console.log("populateMapping");
  console.log(keys);
  console.log(oneToNMapping);
  console.log(nToOneMapping);
  return {
    nToOneMapping,
    keys,
    oneToNMapping,
  };
};

const populateAnswerSimilarity = async (event) => {
  const similarityKeys = await Promise.all(event.matchResults
  .map(async c => ({
    question: c.question,
    similarity: await getS3Json(process.env['DestinationBucket'], c.s3Key.replace('.json', '_similarity.json')),
  })));
  // Convert to Map<question, Map<answer,similarity>>
  return similarityKeys.reduce((acc, curr) => {
    acc.set(curr.question, new Map(Object.entries(curr.similarity)));
    return acc;
  }, new Map());
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
const getDocumentPairs = (keyValuePairJson, questionAnswerSimilarityMap, pages, nToOneMapping, imagePrefix) => {
  let individualKeyValue = new Map();
  let individualConfidenceValue = new Map();
  let individualSimilarityValue = new Map();
  let individualAnswerGeometryValue = new Map();
  let individualAnswerPageImageValue = new Map();
  let documentValuePairs = [];
  let documentConfidencePairs = [];
  let documentSimilarityPairs = [];
  let documentAnswerGeometryPairs = [];
  let documentAnswerPageImagePairs = [];

  for (let y = 0; y < pages.length; y++) {
    let kvs = keyValuePairJson.filter((c) => c.page === pages[y]);
    //Assume document page ordering is correct, then found any repeated key, then consider it is a new document.
    if (kvs.map(c => c.key).some((key) => individualKeyValue.has(key))) {
      documentValuePairs.push(individualKeyValue);
      documentConfidencePairs.push(individualConfidenceValue);
      documentSimilarityPairs.push(individualSimilarityValue);
      documentAnswerGeometryPairs.push(individualAnswerGeometryValue);
      documentAnswerPageImagePairs.push(individualAnswerPageImageValue);
      individualKeyValue = new Map();
      individualConfidenceValue = new Map();
      individualSimilarityValue = new Map();
      individualAnswerGeometryValue = new Map();
      individualAnswerPageImageValue = new Map();
    }

    kvs.map(c => individualKeyValue.set(c.key, c.val));
    kvs.map(c => individualConfidenceValue.set(c.key, c.valConfidence));
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

    kvs.map(c => {
      let image = imagePrefix + 'p-' + c.page + '.png';
      individualAnswerPageImageValue.set(c.key, image);
    });
  }
  documentValuePairs.push(individualKeyValue);
  documentConfidencePairs.push(individualConfidenceValue);
  documentSimilarityPairs.push(individualSimilarityValue);
  documentAnswerGeometryPairs.push(individualAnswerGeometryValue);
  documentAnswerPageImagePairs.push(individualAnswerPageImageValue);

  return {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
    documentAnswerPageImagePairs,
  };
};

const printHeader = (keys, questionAnswerSimilarityMap, sheetObject) => {
  const bgStyle = sheetObject.workbook.createStyle({
    fill: {
      type: 'pattern',
      patternType: 'solid',
      bgColor: '#ffff00',
      fgColor: '#ffff00',
    },
  });
  for (const property in sheetObject) {
    if (property === 'workbook') continue;
    const sheet = sheetObject[property];
    for (let x = 0; x < keys.length; x++) {
      const question = keys[x];
      const isNotMatch = !questionAnswerSimilarityMap.has(question);
      if (isNotMatch) {
        sheet.cell(1, x + 1).style(bgStyle);
      }
      sheet.cell(1, x + 1).string(question);
    }
  }
};

const printContent = (sheet, y, x, value, similarity, valConfidence, geometry, image) => {
  sheet.value.cell(y + 2, x + 1).string(value);
  if(similarity)
    sheet.similarity.cell(y + 2, x + 1).number(similarity);
  sheet.confidence.cell(y + 2, x + 1).number(valConfidence);
  sheet.geometry.cell(y + 2, x + 1).string(JSON.stringify(geometry));
  sheet.image.cell(y + 2, x + 1).string(image);
};

const popularPageSheet = (
  pageSheet,
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
  oneToNMapping,
  imagePrefix,
) => {
  printHeader(keys, questionAnswerSimilarityMap, pageSheet);

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < pages.length; y++) {
      let data;
      if (oneToNMapping.has(keys[x])) {
        const duplicatedKeys = oneToNMapping.get(keys[x]);
        // no need merge as only key mapping must only has one value!
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
        let value, valConfidence, similarity, geometry, image;
        value = data.val;
        valConfidence = data.valConfidence;
        similarity = getSimilarity(keys[x], data.val, questionAnswerSimilarityMap);
        geometry = JSON.stringify(data.valGeometry);
        image = imagePrefix + 'p-' + data.page + '.png';
        image = getS3PreSignedUrl(process.env['DestinationBucket'], image, expires);
        printContent(pageSheet, y, x, value, similarity, valConfidence, geometry, image);
      }
    }
  }
};


const popularDocumentSheet = (
  documentSheet,
  keys,
  pages,
  keyValuePairJson,
  questionAnswerSimilarityMap,
  oneToNMapping,
  nToOneMapping,
  imagePrefix,
) => {
  let {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
    documentAnswerPageImagePairs,
  } = getDocumentPairs(
    keyValuePairJson,
    questionAnswerSimilarityMap,
    pages,
    nToOneMapping,
    imagePrefix,
  );
  printHeader(keys, questionAnswerSimilarityMap, documentSheet);

  for (let x = 0; x < keys.length; x++) {
    for (let y = 0; y < documentValuePairs.length; y++) {
      let value, valConfidence, similarity, geometry, image;
      if (oneToNMapping.has(keys[x])) {
        const duplicatedKeys = oneToNMapping.get(keys[x]);
        value = duplicatedKeys.map(k => documentValuePairs[y].get(k) || '').join('');
        similarity = Math.max(...duplicatedKeys.map(k => documentSimilarityPairs[y].has(k) ? documentSimilarityPairs[y].get(k) : 0));
        valConfidence = Math.max(...duplicatedKeys.map(k => documentConfidencePairs[y].get(k) || 0));
        geometry = duplicatedKeys.map(k => documentAnswerGeometryPairs[y].get(k)).filter(k => k !== undefined)[0];
        image = duplicatedKeys.map(k => documentAnswerPageImagePairs[y].get(k)).filter(k => k !== undefined)[0];

      } else {
        value = documentValuePairs[y].get(keys[x]) || '';
        similarity = documentSimilarityPairs[y].has(keys[x]) ? documentSimilarityPairs[y].get(keys[x]) : 0;
        valConfidence = documentConfidencePairs[y].get(keys[x]) || 0;
        geometry = documentAnswerGeometryPairs[y].get(keys[x]) || {};
        image = documentAnswerPageImagePairs[y].get(keys[x]) || '';
      }
      if (image) image = getS3PreSignedUrl(process.env['DestinationBucket'], image, expires);
      printContent(documentSheet, y, x, value, similarity, valConfidence, geometry, image);
    }
  }
  return {
    documentValuePairs,
    documentConfidencePairs,
    documentSimilarityPairs,
    documentAnswerGeometryPairs,
    documentAnswerPageImagePairs,
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

const getS3PreSignedUrl = (bucketName, keyName, expires) => {
  return s3.getSignedUrl('getObject', {
    Bucket: bucketName,
    Key: keyName,
    Expires: expires,
  });
};