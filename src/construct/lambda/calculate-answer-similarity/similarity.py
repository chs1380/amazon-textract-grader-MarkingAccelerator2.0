from sentence_transformers import SentenceTransformer, util

# model = SentenceTransformer('all-MiniLM-L6-v2',cache_folder="/tmp/")
model = SentenceTransformer('./model',cache_folder="/tmp/")


def handler(event, context):
    sentences = event["studentAnswer"] + event["standardAnswer"]

    # Compute embeddings
    embeddings = model.encode(sentences, convert_to_tensor=True)

    # Compute cosine-similarities for each sentence with each other sentence
    cosine_scores = util.pytorch_cos_sim(embeddings, embeddings)

    # Find the pairs with the highest cosine similarity scores
    pairs = []
    for j in range(1, len(cosine_scores)):
        pairs.append({'text': sentences[j], 'score': cosine_scores[0][j]})

    # Sort scores in decreasing order
    pairs = sorted(pairs, key=lambda x: x['score'], reverse=True)
    return pairs
