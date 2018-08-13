const {DriveExport} = require('../');
const assert = require('chai').assert;

describe('DriveExport basic tests - main process', function() {
  describe('_createMedia()', function() {
    let instance;
    beforeEach(function() {
      instance = new DriveExport(DriveExport.arcDefaults);
    });

    it('Returns a configuration object', function() {
      const result = instance._createMedia({
        body: 'test-string',
        type: 'test-type'
      });
      assert.typeOf(result, 'object');
      assert.equal(result.body, 'test-string');
      assert.equal(result.mimeType, 'test-type');
    });

    it('Returns default type', function() {
      const result = instance._createMedia({
        body: 'test-string'
      });
      assert.equal(result.mimeType, DriveExport.arcDefaults.fileType);
    });
  });

  describe('_createResource()', function() {
    let instance;
    beforeEach(function() {
      instance = new DriveExport(DriveExport.arcDefaults);
    });

    it('Returns object with defaults when no meta config', function() {
      const result = instance._createResource({});
      assert.typeOf(result, 'object');
      assert.equal(result.description, DriveExport.arcDefaults.fileDescription);
    });

    it('Returns the same object', () => {
      const meta = {
        description: 'test',
        file: 'test'
      };
      const result = instance._createResource({meta});
      assert.deepEqual(result, meta);
    });
  });

  describe('_dataSaveHandler()', function() {
    let instance;
    const requestId = 'test-id';
    let meta;
    beforeEach(function() {
      instance = new DriveExport(DriveExport.arcDefaults);
      meta = {
        description: 'test',
        file: 'test'
      };
    });

    it('Calls create() when creating new object', function(done) {
      let called = false;
      instance.create = function() {
        called = true;
        return Promise.resolve({});
      };
      instance._dataSaveHandler({
        sender: {
          send: function() {
            assert.isTrue(called);
            done();
          }
        }
      }, requestId, {
        meta,
        body: 'test'
      });
    });

    it('Calls update() when id is set', function(done) {
      let called = false;
      instance.update = function() {
        called = true;
        return Promise.resolve({});
      };
      instance._dataSaveHandler({
        sender: {
          send: function() {
            assert.isTrue(called);
            done();
          }
        }
      }, requestId, {
        meta,
        body: 'test',
        id: 'test'
      });
    });
  });
});
