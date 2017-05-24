# udsmider
## Required lambda env
- TARGET_SNS_TOPIC_ARN: this should be the ARN of the SNS topic that will trigger a real alarm
- REDIS_PORT: port of redis server
- REDIS_HOST: host of redis server

`rm -rf node_modules && npm i --production && zip -r udsmider.zip index.js package.json node_modules src`

```aws cloudformation create-stack --region us-east-1 --template-body "`cat src/cloudformation.yaml`" --parameters ParameterKey=TargetSNSTopicParam,ParameterValue={sns_arn} --capabilities CAPABILITY_IAM --stack-name mt-test```
