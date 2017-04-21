'use strict';

const BB = require('bluebird');
const AWS = require('aws-sdk');
const SNS = BB.promisifyAll(new AWS.SNS({apiVersion: '2010-03-31'}));
const redis = require('redis');

const rc = BB.promisifyAll(redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST));

const DEBOUNCE_TIME_S = 300; //5 minutes per message forwarded

function _gen_lock_key(subj) {
  return `lock:${subj}`;
}

function _gen_msg_list_key(subj) {
  return `messages:${subj}`;
}

function _send_aggr_alarm(subject, curr_msgs, target_topic_arn) {
  let msg_list_key = _gen_msg_list_key(subject);
  let multi = BB.promisifyAll(rc.multi());
  multi.lrangeAsync(msg_list_key, 0, -1);
  multi.delAsync(msg_list_key);
  return multi.execAsync()
    .then(function(replies){
      let aggregated_message = curr_msgs.concat(replies[0]).join('\n');
      return SNS.publishAsync({
        Message: aggregated_message,
        Subject: subject,
        TopicArn: target_topic_arn
      });
    });
}

function _debounce_sns(subject, message, target_topic_arn, debounce_time_s) {
  let lock_key = _gen_lock_key(subject);
  return rc.setAsync(lock_key, 1, 'NX', 'EX', debounce_time_s)
  .then(function(result){
    if(result === 'OK') {
      return _send_aggr_alarm(subject, [message], target_topic_arn);
    } else {
      return rc.rpushAsync(_gen_msg_list_key(subject), message);
    }
  });
}

function _check_leftovers(target_topic_arn) {
  return rc.keysAsync('*')
  .then(function(keys){
    let lock_subjs = [],
        message_subjs = [];
    keys
      .map((key) => key.split(':'))
      .forEach(function(key_parts){
        if(key_parts[0] === 'lock') {
          lock_subjs.push(key_parts[1]);
        } else if(key_parts[0] === 'messages'){
          message_subjs.push(key_parts[1]);
        }
      });
    let leftovers = message_subjs.reduce(function(acc, val) {
      if(lock_subjs.indexOf(val) === -1) {
        acc.push(val);
      }
      return acc;
    }, []);
    return BB.all(leftovers.map((leftover_subj) => _send_aggr_alarm(leftover_subj, [], target_topic_arn)));
  })
}

function _handler(event, context, callback) {
  if(event.Records && event.Records[0] && event.Records[0].Sns) {
    let sns_obj = event.Records[0].Sns;
    _debounce_sns(sns_obj.Subject, sns_obj.Message, process.env.TARGET_SNS_TOPIC_ARN, DEBOUNCE_TIME_S).then(() => callback()).catch(callback);
  } else {
    _check_leftovers(process.env.TARGET_SNS_TOPIC_ARN).then(() => callback()).catch(callback);
  }
}

exports.handler = _handler;
