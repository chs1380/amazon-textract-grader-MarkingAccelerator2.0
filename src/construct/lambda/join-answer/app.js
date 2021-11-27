const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');
const XLSX = require('xlsx');

exports.lambdaHandler = async (event) => {
  //console.log(JSON.stringify(event));
  fsExtra.emptyDirSync('/tmp/');
  const key = event.scripts.keyValuePairJson;
  const filePath = '/tmp/' + key;
  rmDir(path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  await s3download(process.env['DestinationBucket'], key, filePath);
  const rawData = fs.readFileSync(filePath);
  const keyValuePairJson = JSON.parse(rawData);

  const answerOverrideExcelKey = event.standardAnswer.key.replace('.pdf', '_override.xlsx');
  const isAnswerOverrideExist = await isS3ObjectExist(process.env['DestinationBucket'], answerOverrideExcelKey);
  let answerOverride = new Map();
  if (isAnswerOverrideExist) {
    const excelFilePath = '/tmp/' + answerOverrideExcelKey;
    await s3download(process.env['DestinationBucket'], answerOverrideExcelKey, excelFilePath);
    const workbook = XLSX.readFile(excelFilePath);
    const sheet_name_list = workbook.SheetNames;
    answerOverride = XLSX.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]]);
    answerOverride = new Map(Object.entries(answerOverride[0]));
    console.log(answerOverride);
  }

  let standardAnswerMap = event.result.QuestionAndAnswerList.map(a => ({
    key: a.key,
    val: answerOverride.has(a.key) ? answerOverride.get(a.key) : a.val,
  }))
  .reduce((acc, curr) => {
    if (!acc.has(curr.key)) {
      acc.set(curr.key, curr.val);
    }
    return acc;
  }, new Map());

  const mappingExcelKey = event.scripts.key.replace('.pdf', '_mapping.xlsx');
  const isMappingExist = await isS3ObjectExist(process.env['DestinationBucket'], mappingExcelKey);
  let mapping;
  if (isMappingExist) {
    const excelFilePath = '/tmp/' + mappingExcelKey;
    await s3download(process.env['DestinationBucket'], mappingExcelKey, excelFilePath);
    const workbook = XLSX.readFile(excelFilePath);
    const sheet_name_list = workbook.SheetNames;
    mapping = XLSX.utils.sheet_to_json(workbook.Sheets[sheet_name_list[0]], { header: 1 });

    mapping = mapping.reduce((acc, curr) => {
      const key = curr.reduce((a, c) => {
        if (standardAnswerMap.has(c)) {
          return c;
        }
        return a;
      }, '');
      if (key) {
        curr.map(m => acc.set(m, key));
      } else {
        curr.map(m => acc.set(m, curr[0])); //Use the First column.
      }
      return acc;
    }, new Map());
    console.log(mapping);
  }


  let studentQuestionAndAnswerSet = keyValuePairJson.map(a => ({
      key: a.key,
      val: a.val,
    }))
    .reduce((acc, curr) => {
      if (curr.val.trim().length === 0) //ignore empty answer
      {
        return acc;
      }

      let key = curr.key;
      if (mapping && mapping.has(key)) {
        key = mapping.get(key);
      }

      if (standardAnswerMap.has(key)) {
        if (!acc.match.has(key)) {
          acc.match.set(key, new Set([standardAnswerMap.get(key)]));
        }
        acc.match.get(key).add(curr.val);
      } else {
        if (!acc.notMatch.has(key)) {
          acc.notMatch.set(key, new Set());
        }
        acc.notMatch.get(key).add(curr.val);
      }
      return acc;
    }, {
      match: new Map(),
      notMatch: new Map(),
    }) // Group to question and answer set
  ;

  const matchResults = await Promise.all(Array.from(studentQuestionAndAnswerSet.match).map(async ([key, value]) => {
    const s3Key = event.scripts.keyValuePairJson.replace('.json', '') + '/match/' + encodeURIComponent(key) + '.json';
    const standardAnswer = standardAnswerMap.get(key);
    value.delete(standardAnswer);
    const studentAnswers = Array.from(value);
    studentAnswers.unshift(standardAnswer); // First element must be standard answer!
    await s3.putObject({
      Bucket: process.env['DestinationBucket'],
      Key: s3Key,
      Body: JSON.stringify(studentAnswers),
      ContentType: 'application/json',
    }).promise();
    return ({
      question: key,
      s3Key: s3Key,
    });
  }));
  const notMatchResults = await Promise.all(Array.from(studentQuestionAndAnswerSet.notMatch).map(async ([key, value]) => {
    const s3Key = event.scripts.keyValuePairJson.replace('.json', '') + '/notMatch/' + encodeURIComponent(key) + '.json';
    await s3.putObject({
      Bucket: process.env['DestinationBucket'],
      Key: s3Key,
      Body: JSON.stringify(Array.from(value)),
      ContentType: 'application/json',
    }).promise();
    return ({
      question: key,
      s3Key: s3Key,
    });
  }));


  event.questionAndAnswerList = event.result.QuestionAndAnswerList;
  delete event.result;
  event.matchResults = matchResults;
  event.notMatchResults = notMatchResults;
  if (mapping) {
    event.mapping = mapToObj(mapping);
  }

  return event;
};

const mapToObj = (map) => {
  var obj = {};
  map.forEach(function (v, k) {
    obj[k] = v;
  });
  return obj;
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

const isS3ObjectExist = async (bucketName, keyName) => {
  let params = {
    Bucket: bucketName,
    Key: keyName,
  };
  try {
    await s3.headObject(params).promise();
    return true;
  } catch (headErr) {
    if (headErr.code === 'NotFound') {
      return false;
    }
  }
};

const rmDir = (dirPath) => {
  let files = [];
  try {
    files = fs.readdirSync(dirPath);
  } catch (e) {
    return;
  }
  if (files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      let filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      } else {
        rmDir(filePath);
      }
    }
  }
  if (dirPath !== '/tmp') fs.rmdirSync(dirPath);
};
