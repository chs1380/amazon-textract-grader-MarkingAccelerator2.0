//reference https://github.com/amazon-archives/serverless-image-resizing/blob/master/lambda/index.js
const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const sharp = require("/opt/node_modules/sharp");

exports.lambdaHandler = async (event, context) => {
  console.log(JSON.stringify(event));

  const images = [...Array(event.numberOfImages).keys()].map((x, y) => {
    return {
      key: event.imagePrefix + (y + 1) + ".png",
      file: "/tmp/" + (y + 1) + ".png",
      isInverted: event.invertedPageResults[y],
    };
  });
  console.log(images);

  const rotateResults = await Promise.all(
    images.filter((c) => c.isInverted).map((c) => rotateImage(c.key))
  );

  console.log(rotateResults);

  return event;
};

const rotateImage = async (key) => {
  return new Promise((resolve, reject) => {
    s3.getObject({ Bucket: process.env["ImagesBucket"], Key: key })
      .promise()
      .then((data) => sharp(data.Body).flop().flip().toFormat("png").toBuffer())
      .then((buffer) =>
        s3
          .putObject({
            Body: buffer,
            Bucket: process.env["ImagesBucket"],
            ContentType: "image/png",
            Key: key,
          })
          .promise()
      )
      .then(() => resolve(key))
      .catch((err) => reject(err));
  });
};
