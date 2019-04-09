# udsmider
udsmider is an SNS debouncing tool to prevent a distributed system from flooding another system with alarm notifications. There are a few components:
1) A 'source' SNS topic - this is the topic that your code should send notifications to that you want to be alerted of.
2) A Lambda function to intercept the source notifications and decide whether or not to actually send a notification intended for a human, based on the subject of the SNS notifications.
3) An ElastiCache redis backend to keep track of messages that have been debounced.
4) A 'target' SNS topic - this is the topic that udsmider will forward aggregated notifications to.
5) A Cloudformation template to easily deploy all the pieces necessary for this to work in AWS.

## Getting started
It is easy to get started:
```
aws cloudformation create-stack --region us-east-1 --template-body "`cat src/cloudformation.yml`" --parameters ParameterKey=TargetSNSTopicParam,ParameterValue={sns_arn} --capabilities CAPABILITY_IAM --stack-name udsmider-test
```
where {sns_arn} is an SNS topic you already have that has a subscription set up for you to see (for example, an email address that you receive alarms on).

Once the stack is created, you can test by getting the source SNS topic from the stack output:
```
aws cloudformation describe-stacks --stack-name udsmider-test
```

Then publish a few messages to the SNS topic:
```
aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is a test message" --subject test_subject

aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is another test message" --subject test_subject

aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is yet another test message" --subject test_subject
```

## Updating CloudFormation stack
To update resources defined in the CloudFormation template:

```
aws cloudformation update-stack --region us-east-1 --template-body "`cat src/cloudformation.yml`" --capabilities CAPABILITY_IAM --stack-name udsmider-prod
```

udsmider uses the subject of the messages to debounce, so you should get one notification immediately with 'this is a test message', and then one more notification a few minutes later with the second two messages.

## Updating code
To update the code your lambda function runs:
```
aws lambda update-function-code --function-name {function_name} --s3-bucket cq-os-us-east-1 --s3-key udsmider/udsmider.zip
```
{function_name} should be something like 'udsmider-prod-udsmiderLambda-1EAZZA6B0ALB5'
