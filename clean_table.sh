#!/bin/bash
TABLE_NAME=amazon-textract-grader-dev-TransformFormResultStateMachineConstructTextractBlockTable3BEA0F18-GPBLZ62A3A84
KEY=Key

aws dynamodb scan --region us-east-1 --table-name $TABLE_NAME --attributes-to-get "Key" --query "Items[].Key.S" --output text | tr "\t" "\n" | xargs -t -I keyvalue aws dynamodb delete-item --table-name $TABLE_NAME --region us-east-1  --key '{"Key": {"S": "keyvalue"}}'
