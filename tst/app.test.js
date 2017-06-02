'use strict';

describe('handle', function(){

  let handlerAsync,
      rc,
      sandbox,
      expect,
      publish_spy;

  before(function(){
    process.env.TARGET_SNS_TOPIC_ARN = 'mt_test_arn';
    process.env.REDIS_PORT = '6379';
    process.env.REDIS_HOST = '127.0.0.1';
    sandbox = require('sinon').sandbox.create();
    let AWS = require('aws-sdk');
    let mock_sns = {
      publish: (params, cb) => {cb && cb()}
    };
    publish_spy = sandbox.spy(mock_sns, 'publish');
    sandbox.stub(AWS, 'SNS').callsFake(() => mock_sns);
    expect = require('chai').expect;
    let BB = require('bluebird');
    let handler = require('../src/app.js').handler;
    handlerAsync = BB.promisify(handler);
    rc = BB.promisifyAll(require('redis').createClient());
  });

  afterEach(function(){
    publish_spy.reset();
    return rc.delAsync('lock:test_subj', 'messages:test_subj', 'messages:test_subj_cw');
  });

  after(function(){
    sandbox.restore();
  });

  describe('sns events', function(){

    it('should forward the first sns message to the real alarm topic', function(){
      let fake_sns_event = {
        Records: [
          {
            Sns: {
              Timestamp: '1970-01-01T00:00:00.000Z',
              Subject: 'test_subj',
              Message: 'test msg'
            }
          }
        ]
      }
      return handlerAsync(fake_sns_event, {})
      .then(function(){
        expect(publish_spy.args[0][0]).to.eql({
          Message: 'Message 1(1970-01-01T00:00:00.000Z): test msg',
          Subject: 'test_subj',
          TopicArn: 'mt_test_arn'
        });
      });
    });

    it('should debounce messages and send a single digest message', function(){
      // set the lock key to prevent messages from firing
      return rc.setAsync('lock:test_subj', 1)
      .then(function(){
        let fake_sns_event1 = {
          Records: [
            {
              Sns: {
                Timestamp: '1970-01-01T00:00:00.000Z',
                Subject: 'test_subj',
                Message: 'test msg 1'
              }
            }
          ]
        };
        return handlerAsync(fake_sns_event1, {});
      }).then(function(){
        // delete lock key, so aggregated digest message will fire
        return rc.delAsync('lock:test_subj');
      }).then(function(){
        let fake_sns_event2 = {
          Records: [
            {
              Sns: {
                Timestamp: '1970-01-01T00:00:00.000Z',
                Subject: 'test_subj',
                Message: 'test msg 2'
              }
            }
          ]
        };
        return handlerAsync(fake_sns_event2, {});
      }).then(function(){
        expect(publish_spy.calledOnce).to.be.true;
        expect(publish_spy.args[0][0]).to.eql({
          Message: ['Message 1(1970-01-01T00:00:00.000Z): test msg 1', 'Message 2(1970-01-01T00:00:00.000Z): test msg 2'].join('\n--------------'),
          Subject: 'test_subj',
          TopicArn: 'mt_test_arn'
        });
        return rc.lrangeAsync('messages:test_subj', 0, -1);
      }).then(function(messages){
        expect(messages).to.have.length(0);
      });
    });

  });

  describe('coudwatch events', function(){
    // sample cloudwatch event: http://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-scheduled-event
    // basically, there is no important data in the event for us to use

    it('should clean up any messages in the queue', function(){
      let leftovers = [
        JSON.stringify({
          Timestamp: '1970-01-01T00:00:00.000Z',
          Subject: 'test_subj_cw',
          Message: 'leftover 2'
        }),
        JSON.stringify({
          Timestamp: '1970-01-01T00:00:00.000Z',
          Subject: 'test_subj_cw',
          Message: 'leftover 1'
        })
      ];
      return rc.rpushAsync('messages:test_subj_cw', leftovers[0], leftovers[1])
      .then(() => handlerAsync({}, {}))
      .then(function(){
        expect(publish_spy.calledOnce).to.be.true;
        expect(publish_spy.args[0][0]).to.eql({
          Message: ['Message 1(1970-01-01T00:00:00.000Z): leftover 2', 'Message 2(1970-01-01T00:00:00.000Z): leftover 1'].join('\n--------------'),
          Subject: 'test_subj_cw',
          TopicArn: 'mt_test_arn'
        });
      });
    });

  });

});
