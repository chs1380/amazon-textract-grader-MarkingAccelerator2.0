from sentence_transformers import SentenceTransformer

def get_model(model):
  """Loads model from Hugginface model hub"""
  try:
    model = SentenceTransformer(model)
    model.save('./model')
  except Exception as e:
    raise(e)

get_model('all-MiniLM-L6-v2')