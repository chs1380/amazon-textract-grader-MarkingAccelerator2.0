const AWS = require('aws-sdk');
const s3 = new AWS.S3();
const fs = require('fs');
const fsExtra = require('fs-extra');
const { promisify } = require('util');
const pdf2img = require('./pdf2img');

const readFile = promisify(fs.readFile);

exports.lambdaHandler = async (event) => {
  console.log(JSON.stringify(event));
  const srcBucket = process.env['PdfSourceBucket'];
  const srcKey = event.key;
  fsExtra.emptyDirSync('/tmp/');
  const destKeyPrefix = decodeURI(srcKey).replace('.pdf', '');
  const outputDirectory = '/tmp/' + destKeyPrefix;
  fs.existsSync(outputDirectory) || fs.mkdirSync(outputDirectory, { recursive: true });
  const filePath = '/tmp/' + decodeURI(srcKey);
  await s3download(srcBucket, srcKey, filePath);

  const stats = fs.statSync(filePath);
  console.log('File Size in Bytes:- ' + stats.size);
  const results = await convert2images(filePath, '/tmp');
  console.log(results);

  const s3Results = await Promise.all(
    results.map(async (c) => {
      console.log(c);
      let data = await readFile(c.path);
      let key = srcKey.replace('.pdf', '') + '/' + c.path.replace('/tmp/', '');
      return await s3
      .putObject({
        Bucket: process.env['ImagesBucket'],
        Key: key,
        Body: data,
        ContentType: 'image/png',
      })
      .promise();
    }),
  );
  console.log(s3Results);
  const images = results.map((c) => c.path.replace('/tmp/', ''));

  event.imagePrefix = srcKey.replace('.pdf', '') + '/' + images[0].replace('1.png', '');
  event.numberOfImages = images.length;
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

const convert2images = async (filePath, outputdir) => {
  pdf2img.setOptions({
    type: 'png', // png or jpg, default jpg
    density: 600, // default 600
    outputdir, // output folder, default null (if null given, then it will create folder name same as file name)
    outputname: 'p', // output file name, dafault null (if null given, then it will create image name same as input name)
  });
  return await pdf2img.convert(filePath);
};
