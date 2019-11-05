![CodeBuild](https://codebuild.us-east-1.amazonaws.com/badges?uuid=eyJlbmNyeXB0ZWREYXRhIjoiclkxNjJhcUFSZG5LSVlmSHdkSndkeUk0bVllSVBxc0VLOUJIbURmZTZiUEhyR015V3pwTnlIeUd6R3hORFFTUmU0QjM4TDgxRjByL1cvem1SN3dTV2JZPSIsIml2UGFyYW1ldGVyU3BlYyI6Ii9SVmdwckhZNGQrNk9NTVciLCJtYXRlcmlhbFNldFNlcmlhbCI6MX0%3D&branch=master)
# udsmider
udsmider is an SNS debouncing tool to prevent a distributed system from flooding another system with alarm notifications. There are a few components:
1) A 'source' SNS topic - this is the topic that your code should send notifications to that you want to be alerted of.
2) A Lambda function to intercept the source notifications and decide whether or not to actually send a notification intended for a human, based on the subject of the SNS notifications.
3) An ElastiCache redis backend to keep track of messages that have been debounced.
4) A 'target' SNS topic - this is the topic that udsmider will forward aggregated notifications to.
5) A Cloudformation template to easily deploy all the pieces necessary for this to work in AWS.

## Getting started
Add your new one to the terraform files at https://github.com/cquotient/Automation/tree/master/production/services/udsmider and run the apply for applicable regions.

Then publish a few messages to the SNS topic:
```
aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is a test message" --subject test_subject

aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is another test message" --subject test_subject

aws sns publish --topic-arn arn:aws:sns:us-east-1:117684984046:mt-test4-udsmiderSourceSNSTopic-A1Q5PTGEYN6N --message "this is yet another test message" --subject test_subject
```

## Updating code
To update the code your lambda function runs:
```
aws lambda update-function-code --function-name {function_name} --s3-bucket cq-os-us-east-1 --s3-key udsmider/udsmider.zip
```
{function_name} should be something like 'udsmider-prod-udsmiderLambda-1EAZZA6B0ALB5'
