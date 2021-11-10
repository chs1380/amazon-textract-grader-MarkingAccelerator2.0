const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

exports.lambdaHandler = async(event) => {
  console.log(JSON.stringify(event));
  fsExtra.emptyDirSync('/tmp/');
  const key = event.scripts.keyValuePairJson;
  const filePath = '/tmp/' + key;
  rmDir(path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  await s3download(process.env['DestinationBucket'], key, filePath);
  const rawData = fs.readFileSync(filePath);
  const keyValuePairJson = JSON.parse(rawData);

  let standardAnswerMap = event.result.QuestionAndAnswerList.map(a => ({
    key: a.key,
    val: a.val
  }))
  .reduce((acc, curr) => {
    if (!acc.has(curr.key)) {
      acc.set(curr.key, curr.val);
    }
    return acc;
  }, new Map());

  let studentQuestionAndAnswerSet = keyValuePairJson.map(a => ({
      key: a.key,
      val: a.val
    }))
    .reduce((acc, curr) => {
      if (curr.val.trim().length === 0) //ignore empty answer
        return acc;

      if (standardAnswerMap.has(curr.key)) {
        if (!acc.match.has(curr.key)) {
          acc.match.set(curr.key, new Set([standardAnswerMap.get(curr.key)]));
        }
        acc.match.get(curr.key).add(curr.val);
      }
      else {
        if (!acc.notMatch.has(curr.key)) {
          acc.notMatch.set(curr.key, new Set());
        }
        acc.notMatch.get(curr.key).add(curr.val);
      }
      return acc;
    }, {
      match: new Map(),
      notMatch: new Map()
    }) // Group to question and answer set
  ;

  const matchResults = await Promise.all(Array.from(studentQuestionAndAnswerSet.match).map(async([key, value]) => {
    const s3Key = event.scripts.keyValuePairJson.replace(".json", "") + "/match/" + encodeURIComponent(key) + ".json";
    await s3.putObject({
      Bucket: process.env['DestinationBucket'],
      Key: s3Key,
      Body: JSON.stringify(Array.from(value)),
      ContentType: "application/json",
    }).promise();
    return ({ question: key, s3Key: s3Key });
  }));
  const notMatchResults = await Promise.all(Array.from(studentQuestionAndAnswerSet.notMatch).map(async([key, value]) => {
    const s3Key = event.scripts.keyValuePairJson.replace(".json", "") + "/notMatch/" + encodeURIComponent(key) + ".json";
    await s3.putObject({
      Bucket: process.env['DestinationBucket'],
      Key: s3Key,
      Body: JSON.stringify(Array.from(value)),
      ContentType: "application/json",
    }).promise();
    return ({ question: key, s3Key: s3Key });
  }));


  event.questionAndAnswerList=event.result.QuestionAndAnswerList;
  delete event.result;
  event.matchResults = matchResults;
  event.notMatchResults=notMatchResults;
  return event;
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

const rmDir = (dirPath) => {
  let files = [];
  try {
    files = fs.readdirSync(dirPath);
  }
  catch (e) {
    return;
  }
  if (files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      let filePath = dirPath + '/' + files[i];
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
      else {
        rmDir(filePath);
      }
    }
  }
  if (dirPath !== '/tmp') fs.rmdirSync(dirPath);
};
