'use strict';

describe('handle', function(){

  let handler,
      handlerAsync,
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
      publish: (params, cb) => {!!cb && cb()}
    };
    publish_spy = sandbox.spy(mock_sns, 'publish');
    sandbox.stub(AWS, 'SNS').callsFake(() => mock_sns);
    expect = require('chai').expect;
    let BB = require('bluebird');
    handler = require('../src/app.js').handler;
    handlerAsync = BB.promisify(handler);
    rc = BB.promisifyAll(require('redis').createClient());
  });

  afterEach(function(){
    publish_spy.reset();
    return rc.delAsync('lock:test_subj', 'messages:test_subj');
  });

  after(function(){
    sandbox.restore();
  });

  describe('sns events', function(){
    it('should forward the first sns message to the real alarm topic', function(done){
      let fake_sns_event = {
        Records: [
          {
            Sns: {
              Subject: 'test_subj',
              Message: 'test msg'
            }
          }
        ]
      }
      handler(fake_sns_event, {}, function(err){
        expect(publish_spy.args[0][0]).to.eql({
          Message: 'test msg',
          Subject: 'test_subj',
          TopicArn: 'mt_test_arn'
        });
        done(err);
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
          Message: ['test msg 2', 'test msg 1'].join('\n'),
          Subject: 'test_subj',
          TopicArn: 'mt_test_arn'
        });
        return rc.lrangeAsync('messages:test_subj', 0, -1);
      }).then(function(messages){
        expect(messages).to.have.length(0);
      });
    });
  });

});
