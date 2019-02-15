const {ipcRenderer: ipc} = require('electron');
/**
 * A class to be used in the renderer process that listens for drive
 * events and communicates with drive instance in the main process.
 */
class ArcElectronDrive {
  constructor() {
    this._dataSaveHandler = this._dataSaveHandler.bind(this);
    this._dataInsertResult = this._dataInsertResult.bind(this);
    this._dataInsertError = this._dataInsertError.bind(this);
    /**
     * Map of pending promises. Keys are request IDs.
     */
    this._promises = {};
    /**
     * Last used request id
     */
    this._index = 0;
  }
  /**
   * Listens for both ipc and web events and makes the magic happen.
   */
  listen() {
    window.addEventListener('google-drive-data-save', this._dataSaveHandler);
    ipc.on('google-drive-data-save-result', this._dataInsertResult);
    ipc.on('google-drive-data-save-error', this._dataInsertError);
  }
  /**
   * Stops listening to the web and ipc events.
   */
  unlisten() {
    window.removeEventListener('google-drive-data-save', this._dataSaveHandler);
    ipc.removeListener('google-drive-data-save-result', this._dataInsertResult);
    ipc.removeListener('google-drive-data-save-error', this._dataInsertError);
  }
  /**
   * Adds new promise to the list of pending promises.
   * @param {Number} id Event request id
   * @param {Function} resolve
   * @param {Function} reject
   */
  _addPromise(id, resolve, reject) {
    this._promises[id] = {
      resolve: resolve,
      reject: reject
    };
  }
  /**
   * Handler for web `google-drive-data-save` event.
   * @param {CustomEvent} e
   */
  _dataSaveHandler(e) {
    e.preventDefault();
    const id = (++this._index);
    let {content, file, options} = e.detail;
    if (!options) {
      options = {};
    }
    const meta = {
      name: file
    };
    if (options.parents && options.parents instanceof Array) {
      const parents = [];
      options.parents.forEach((item) => {
        if (!item) {
          return;
        }
        if (typeof item === 'string' && item.toLowercase() !== 'my drive') {
          parents.push(item);
        } else if (typeof item.name === 'string' && item.name.toLowercase() !== 'my drive') {
          parents.push(item);
        }
      });
      if (parents.length) {
        meta.parents = parents;
      }
    }
    ipc.send('google-drive-data-save', id, {
      meta,
      type: options.contentType,
      body: content
    });
    e.detail.result = new Promise((resolve, reject) => {
      this._addPromise(id, resolve, reject);
    });
  }
  /**
   * Handler for ipc `google-drive-data-save-result` event
   * @param {Event} e
   * @param {String} id
   * @param {Object} result
   */
  _dataInsertResult(e, id, result) {
    const promise = this._promises[id];
    if (!promise) {
      return;
    }
    delete this._promises[id];
    promise.resolve(result);
  }
  /**
   * Handler for ipc `google-drive-data-save-error` event
   * @param {Event} e
   * @param {String} id
   * @param {Object} cause
   */
  _dataInsertError(e, id, cause) {
    const promise = this._promises[id];
    if (!promise) {
      return;
    }
    delete this._promises[id];
    promise.reject(cause);
  }
}
module.exports.ArcElectronDrive = ArcElectronDrive;
