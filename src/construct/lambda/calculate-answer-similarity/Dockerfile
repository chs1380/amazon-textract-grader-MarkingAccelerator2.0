ARG FUNCTION_DIR="/function"

FROM huggingface/transformers-pytorch-cpu as build-image


# Include global arg in this stage of the build
ARG FUNCTION_DIR

# Install aws-lambda-cpp build dependencies
RUN apt-get update && \
  apt-get install -y \
  g++ \
  make \
  cmake \
  unzip \
  libcurl4-openssl-dev

# Create function directory
RUN mkdir -p ${FUNCTION_DIR}

# Install the function's dependencies
RUN pip uninstall --yes jupyter
RUN pip install --target ${FUNCTION_DIR} awslambdaric boto3
RUN pip install --target ${FUNCTION_DIR} sentence-transformers

# Get Model
COPY get_model.py ${FUNCTION_DIR}
RUN mkdir -p ${FUNCTION_DIR}/model
RUN cd ${FUNCTION_DIR}/ && python3 get_model.py

# Copy handler function
COPY similarity.py ${FUNCTION_DIR}

FROM huggingface/transformers-pytorch-cpu

# Include global arg in this stage of the build
ARG FUNCTION_DIR
# Set working directory to function root directory
WORKDIR ${FUNCTION_DIR}

# Copy in the built dependencies
COPY --from=build-image ${FUNCTION_DIR} ${FUNCTION_DIR}
ENV PYTHONIOENCODING utf-8
ENTRYPOINT ["python3", "-m", "awslambdaric" ]

# This will get replaced by the proper handler by the CDK script
CMD [ "similarity.handler" ]