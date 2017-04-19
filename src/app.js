'use strict';

const AWS = require('aws-sdk');
const SNS = new AWS.SNS({apiVersion: '2010-03-31'});
const BB = require('bluebird');
const redis = require('redis');

const rc = BB.promisifyAll(redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST));

const DEBOUNCE_TIME_S = 300; //5 minutes per message forwarded

function _gen_lock_key(subj) {
  return `lock:${subj}`;
}

function _gen_msg_list_key(subj) {
  return `messages:${subj}`;
}

function _debounce_sns(subject, message, target_topic_arn, debounce_time_s, callback) {
  let lock_key = _gen_lock_key(subject);
  return rc.setAsync(lock_key, 1, 'NX', 'EX', debounce_time_s)
  .then(function(result){
    let msg_list_key = _gen_msg_list_key(subject);
    if(result === 'OK') {
      return rc.multi()
        .lrange(msg_list_key, 0, -1)
        .del(msg_list_key)
        .exec(function(err, replies){
          let aggregated_message = [message].concat(replies[0]).join('\n');
          SNS.publish({
            Message: aggregated_message,
            Subject: subject,
            TopicArn: target_topic_arn
          }, callback);
        });
    } else {
      rc.rpush(msg_list_key, message);
      callback();
    }
  }).catch(callback);
}

function _handler(event, context, callback) {
  if(event.Records && event.Records[0] && event.Records[0].Sns) {
    let sns_obj = event.Records[0].Sns;
    _debounce_sns(sns_obj.Subject, sns_obj.Message, process.env.TARGET_SNS_TOPIC_ARN, DEBOUNCE_TIME_S, callback);
  } else {

  }
}

exports.handler = _handler;
