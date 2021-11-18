// const fs = require('fs');
// const AWS = require('aws-sdk');
// const s3 = new AWS.S3();
//
// const s3download = async (bucketName, keyName, localDest) => {
//   if (typeof localDest == 'undefined') {
//     localDest = keyName;
//   }
//   let params = {
//     Bucket: bucketName,
//     Key: keyName,
//   };
//   const data = await s3.getObject(params).promise();
//   fs.writeFileSync(localDest, data.Body);
// };
//
// const rmDir = (dirPath) => {
//   let files = [];
//   try {
//     files = fs.readdirSync(dirPath);
//   } catch (e) {
//     return;
//   }
//   if (files.length > 0) {
//     for (let i = 0; i < files.length; i++) {
//       let filePath = dirPath + '/' + files[i];
//       if (fs.statSync(filePath).isFile()) {
//         fs.unlinkSync(filePath);
//       } else {
//         rmDir(filePath);
//       }
//     }
//   }
//   if (dirPath !== '/tmp') fs.rmdirSync(dirPath);
// };
