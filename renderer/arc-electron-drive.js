const {ipcRenderer: ipc} = require('electron');
/**
 * A class to be used in the renderer process that listens for drive
 * events and communicates with drive instance in the main process.
 */
class ArcElectronDrive {
  constructor() {
    this._dataSaveHandler = this._dataSaveHandler.bind(this);
    this._mainResultHandler = this._mainResultHandler.bind(this);
    this._mainErrorHandler = this._mainErrorHandler.bind(this);
    this._listAppFoldersHandler = this._listAppFoldersHandler.bind(this);
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
    window.addEventListener('google-drive-list-app-folders', this._listAppFoldersHandler);
    ipc.on('google-drive-operation-result', this._mainResultHandler);
    ipc.on('google-drive-operation-error', this._mainErrorHandler);
  }
  /**
   * Stops listening to the web and ipc events.
   */
  unlisten() {
    window.removeEventListener('google-drive-data-save', this._dataSaveHandler);
    window.removeEventListener('google-drive-list-app-folders', this._listAppFoldersHandler);
    ipc.removeListener('google-drive-operation-result', this._mainResultHandler);
    ipc.removeListener('google-drive-operation-error', this._mainErrorHandler);
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
        if (typeof item === 'string') {
          if (item.toLowerCase() === 'my drive') {
            item = {id: 'root', name: item};
          }
          parents.push(item);
        } else if (typeof item.name === 'string') {
          if (item.name.toLowerCase() === 'my drive') {
            item = Object.assign({}, item);
            item.id = 'root';
          }
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
   * Handler for `google-drive-list-app-folders` event.
   * Requests to get Drive folders list created by this application.
   * @param {CustomEvent} e
   */
  _listAppFoldersHandler(e) {
    e.preventDefault();
    const id = (++this._index);
    ipc.send('google-drive-list-app-folders', id, {interactive: false});
    e.detail.result = new Promise((resolve, reject) => {
      this._addPromise(id, resolve, reject);
    });
  }
  /**
   * Handler for ipc `google-drive-operation-result` event
   * @param {Event} e
   * @param {String} id
   * @param {Object} result
   */
  _mainResultHandler(e, id, result) {
    const promise = this._promises[id];
    if (!promise) {
      return;
    }
    delete this._promises[id];
    promise.resolve(result);
  }
  /**
   * Handler for ipc `google-drive-operation-error` event
   * @param {Event} e
   * @param {String} id
   * @param {Object} cause
   */
  _mainErrorHandler(e, id, cause) {
    const promise = this._promises[id];
    if (!promise) {
      return;
    }
    delete this._promises[id];
    promise.reject(cause);
  }
}
module.exports.ArcElectronDrive = ArcElectronDrive;
