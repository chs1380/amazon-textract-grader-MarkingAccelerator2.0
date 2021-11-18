from sentence_transformers import SentenceTransformer, util
import boto3
import json, os

s3 = boto3.resource('s3')
model = SentenceTransformer('./model',cache_folder="/tmp/")

def handler(event, context):

    if "key" in event:
        content_object = s3.Object(os.environ['DestinationBucket'], event["key"])
        file_content = content_object.get()['Body'].read().decode('utf-8')
        sentences = json.loads(file_content)
    else:
        sentences = event["studentAnswer"]
        sentences.insert(0,event["standardAnswer"])

    # Compute embeddings
    embeddings = model.encode(sentences, convert_to_tensor=True)

    # Compute cosine-similarities for each sentence with each other sentence
    cosine_scores = util.pytorch_cos_sim(embeddings, embeddings)

    # Find the pairs with the highest cosine similarity scores
    pairs = []
    for j in range(0, len(cosine_scores)):
        pairs.append(float(cosine_scores[0][j]))

    event["similarity"]=pairs
    return event

