const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const fsExtra = require('fs-extra');
const path = require('path');

exports.lambdaHandler = async (event) => {
  console.log(JSON.stringify(event));
  fsExtra.emptyDirSync('/tmp/');
  const key = event.key;
  const similarity = event.similarity;

  const filePath = '/tmp/' + key;
  rmDir(path.dirname(filePath));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  await s3download(process.env['DestinationBucket'], key, filePath);
  const rawData = fs.readFileSync(filePath);
  const answers = JSON.parse(rawData);

  let results = {};
  for (let i = 0; i < answers.length; i++) {
    results[answers[i]] = similarity[i];
  }

  await s3.putObject({
    Bucket: process.env['DestinationBucket'],
    Key: key.replace(".json","_similarity.json"),
    Body: JSON.stringify(results),
    ContentType: 'application/json',
  }).promise();
  delete event.similarity;
  return event;
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
