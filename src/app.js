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

function _handler(event, context, callback) {
  let sns_obj = event.Records[0].Sns;
  let lock_key = _gen_lock_key(sns_obj.Subject);
  return rc.setAsync(lock_key, 1, 'NX', 'EX', DEBOUNCE_TIME_S)
  .then(function(result){
    let msg_list_key = _gen_msg_list_key(sns_obj.Subject);
    if(result === 'OK') {
      return rc.lrangeAsync(msg_list_key, 0, -1).then(function(messages){
        let message = [sns_obj.Message].concat(messages).join('\n');
        SNS.publish({
          Message: message,
          Subject: sns_obj.Subject,
          TopicArn: process.env.TARGET_SNS_TOPIC_ARN
        }, callback);
      });
    } else {
      rc.rpush(msg_list_key, sns_obj.Message);
      callback();
    }
  }).catch(callback);
}

exports.handler = _handler;
