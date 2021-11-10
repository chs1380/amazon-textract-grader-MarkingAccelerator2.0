from sentence_transformers import SentenceTransformer, util

model = SentenceTransformer('./model',cache_folder="/tmp/")

def handler(event, context):
    sentences = event["studentAnswer"]
    sentences.insert(0,event["standardAnswer"])
    print(sentences)

    # Compute embeddings
    embeddings = model.encode(sentences, convert_to_tensor=True)

    # Compute cosine-similarities for each sentence with each other sentence
    cosine_scores = util.pytorch_cos_sim(embeddings, embeddings)

    # Find the pairs with the highest cosine similarity scores
    pairs = {}
    for j in range(1, len(cosine_scores)):
        pairs[sentences[j]] = float(cosine_scores[0][j])

    return pairs

