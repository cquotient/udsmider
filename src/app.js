'use strict';

const BB = require('bluebird');
const AWS = require('aws-sdk');
const SNS = BB.promisifyAll(new AWS.SNS({apiVersion: '2010-03-31'}));
const redis = require('redis');

const DEBOUNCE_TIME_S = 300; //5 minutes per message forwarded

function _gen_lock_key(subj) {
  return `lock:${subj}`;
}

function _gen_msg_list_key(subj) {
  return `messages:${subj}`;
}

function _send_aggr_alarm(rc, subject, curr_msgs, target_topic_arn) {
  console.log(`sending aggregated alarm for '${subject}' to ${target_topic_arn}`);
  let msg_list_key = _gen_msg_list_key(subject);
  let multi = BB.promisifyAll(rc.multi());
  multi.lrangeAsync(msg_list_key, 0, -1);
  multi.delAsync(msg_list_key);
  return multi.execAsync()
    .then(function(replies){
      console.log(`got redis response: ${JSON.stringify(replies)}`);
      let aggregated_message =
        replies[0]
        .map((sns_msg_as_text) => JSON.parse(sns_msg_as_text))
        .concat(curr_msgs)
        .map((sns_msg_obj, idx) => `Message ${idx+1}(${sns_msg_obj.Timestamp}): ${sns_msg_obj.Message}`)
        .join('\n--------------\n');
      return SNS.publishAsync({
        Message: aggregated_message,
        Subject: subject,
        TopicArn: target_topic_arn
      }).then(function(resp){
        console.log(`sns response: ${JSON.stringify(resp)}`);
      }).catch(function(err){
        console.log(`sns error: ${JSON.stringify(err)}`);
      });
    });
}

function _debounce_sns(rc, sns_obj, target_topic_arn, debounce_time_s) {
  let lock_key = _gen_lock_key(sns_obj.Subject);
  return rc.setAsync(lock_key, 1, 'NX', 'EX', debounce_time_s)
  .then(function(result){
    if(result === 'OK') {
      return _send_aggr_alarm(rc, sns_obj.Subject, [sns_obj], target_topic_arn);
    } else {
      console.log(`debounced: '${sns_obj.Message}' with subject: '${sns_obj.Subject}'`)
      return rc.rpushAsync(_gen_msg_list_key(sns_obj.Subject), JSON.stringify(sns_obj));
    }
  });
}

function _check_leftovers(rc, target_topic_arn) {
  /*
    i know what you're thinking, this seems kind of crazy. keep in mind that there
    should pretty much always be very few keys in this redis instance, and it should
    not be serving any traffic. there are other ways to accomplish this, but this
    seemed like the simplest way
  */
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
    console.log(`got leftovers: ${JSON.stringify(leftovers)}`);
    return BB.all(leftovers.map((leftover_subj) => _send_aggr_alarm(rc, leftover_subj, [], target_topic_arn)));
  })
}

function _cleanup(err, rc, cb) {
  rc.quit();
  rc.on('end', () => cb(err));
}

function _handler(event, context, callback) {
  let rc = BB.promisifyAll(redis.createClient(process.env.REDIS_PORT, process.env.REDIS_HOST));
  console.log(`debouncing with: ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`)
  if(event.Records && event.Records[0] && event.Records[0].Sns) {
    let sns_obj = event.Records[0].Sns;
    console.log(`handling sns: ${JSON.stringify(sns_obj)}`);
    _debounce_sns(rc, sns_obj, process.env.TARGET_SNS_TOPIC_ARN, DEBOUNCE_TIME_S).then((function(){
      _cleanup(null, rc, callback);
    })).catch(function(err){
      _cleanup(err, rc, callback);
    });
  } else {
    console.log(`handling cloudwatch event`);
    _check_leftovers(rc, process.env.TARGET_SNS_TOPIC_ARN).then(function(){
      _cleanup(null, rc, callback);
    }).catch(function(err){
      _cleanup(err, rc, callback);
    });
  }
}

exports.handler = _handler;
