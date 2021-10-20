const AWS = require("aws-sdk");
const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();

exports.lambdaHandler = async (event, context) => {
  console.log(JSON.stringify(event));

  const images = [...Array(event.numberOfImages).keys()].map(
    (x, y) => event.imagePrefix + (y + 1) + ".png"
  );

  const { detectTexts } = await detectText(images);

  const markerText = getWordAtTopLeft(detectTexts[0]);

  console.log("Marker Text" + markerText);

  event.invertedPageResults = detectTexts
    .map(getWordAtTopLeft)
    .map((firstLine) => firstLine !== markerText);
  return event;
};

const getWordAtTopLeft = (detectResult) => {
  const firstLine = detectResult.TextDetections.filter(
    (c) => c.Type === "LINE"
  ).reduce((prev, curr) => {
    return prev.Geometry.BoundingBox.Top < curr.Geometry.BoundingBox.Top
      ? prev
      : curr;
  });

  console.log(firstLine.DetectedText);
  if (firstLine) {
    const firstWord = detectResult.TextDetections.filter(
      (c) => c.ParentId === firstLine.Id
    ).reduce((prev, curr) => {
      return prev.Geometry.BoundingBox.Left < curr.Geometry.BoundingBox.Left
        ? prev
        : curr;
    });
    return firstWord.DetectedText;
  }
  return "";
};

const detectText = async (images) => {
  const results = await Promise.all(
    images.map(async (key) => {
      const params = {
        Image: {
          /* required */
          S3Object: {
            Bucket: process.env["ImagesBucket"],
            Name: key,
          },
        },
      };
      const result = await rekognition.detectText(params).promise();
      const resultKey = key.replace(".png", "_text.json");
      await s3
        .putObject({
          Bucket: process.env["TextractBucket"],
          Key: resultKey,
          Body: JSON.stringify(result),
          ContentType: "application/json",
        })
        .promise();
      return { resultKey, result };
    })
  );

  return {
    resultKeys: results.map((c) => c.resultKey),
    detectTexts: results.map((c) => c.result),
  };
};