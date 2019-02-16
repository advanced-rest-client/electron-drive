/**
 * @copyright Copyright 2018 Pawel Psztyc
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not
 * use this file except in compliance with the License. You may obtain a copy of
 * the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations under
 * the License.
 ******************************************************************************/

const {Oauth2Identity} = require('@advanced-rest-client/electron-oauth2');
const {ipcMain, net} = require('electron');
/**
 * A class that is responsible for exporting data to Google Drive.
 * The class is to be used with the main process.
 */
class DriveExport {
  static get arcDefaults() {
    return {
      mime: 'application/restclient+data',
      fileDescription: 'Advanced REST client data export file.',
      fileType: 'application/json'
    };
  }
  /**
   * @param {Object} opts Instance defaults
   * - `mime` Default mime type for a file if not defined when updating.
   */
  constructor(opts) {
    if (!opts) {
      opts = {};
    }
    /**
     * Drive's registered content type.
     * It will be used to search for app's files in the Drive.
     * Drive's handlers will recognize the app and will run it from Drive UI.
     */
    this.mime = opts.opts;
    /**
     * A default file description
     */
    this.fileDescription = opts.fileDescription;
    /**
     * A default file media type
     */
    this.fileType = opts.fileType;
    this._dataSaveHandler = this._dataSaveHandler.bind(this);
    this._listAppFoldersHandler = this._listAppFoldersHandler.bind(this);
    this._getFileHandler = this._getFileHandler.bind(this);
    /**
     * List of cached folders created by the app.
     */
    this.cachedFolders = undefined;
  }
  /**
   * Listens for renderer events.
   */
  listen() {
    ipcMain.on('google-drive-data-save', this._dataSaveHandler);
    ipcMain.on('google-drive-list-app-folders', this._listAppFoldersHandler);
    ipcMain.on('google-drive-get-file', this._getFileHandler);
  }
  /**
   * Remove event listeners from the main IPC
   */
  unlisten() {
    ipcMain.removeListener('google-drive-data-save', this._dataSaveHandler);
    ipcMain.removeListener('google-drive-list-app-folders', this._listAppFoldersHandler);
    ipcMain.removeListener('google-drive-get-file', this._getFileHandler);
  }
  /**
   * Handler for `google-drive-data-save` event emmited by the renderer proccess
   *
   * @param {Event} e
   * @param {String} requestId Arbitrary string to report back with the response
   * @param {Object} config Request configuration data:
   * - `{Object}` `meta` - Google Drive file resource values. See Google Drive API
   * documentation for details.
   * - `{String|Object}` `body` - File data. Objects are serialized to JSON.
   * - `{String}` `type` - File content type. Defaults to `application/json`
   * - `{String}` `id` - Existing Drive file id. If present the file is being
   * updated.
   * - `{Object}` `auth` - Authorization data to use. If it contains `accessToken`
   * property it will skip authorization and use this token. Otherwise it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   */
  _dataSaveHandler(e, requestId, config) {
    const {auth, id} = config;
    const meta = this._createResource(config);
    const media = this._createMedia(config);
    let p;
    if (id) {
      p = this.update(id, meta, media, auth);
    } else {
      p = this.create(meta, media, auth);
    }
    p.then((result) => {
      e.sender.send('google-drive-operation-result', requestId, result);
    })
    .catch((cause) => {
      if (cause instanceof Error) {
        cause = {
          message: cause.message
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    });
  }
  /**
   * Creates media data used by this library
   * @param {Object} config Passed user configuration
   * @return {Object} Resource object
   */
  _createMedia(config) {
    let {body, type} = config;
    if (typeof body !== 'string') {
      body = JSON.stringify(body);
    }
    const media = {
      mimeType: type || this.fileType,
      body
    };
    return media;
  }
  /**
   * Creates resource data for Drive file.
   * @param {Object} config Passed user configuration
   * @return {Object} Resource object
   */
  _createResource(config) {
    let {meta} = config;
    if (!meta) {
      meta = {};
    }
    if (!meta.description && this.fileDescription) {
      meta.description = this.fileDescription;
    }
    return meta;
  }
  /**
   * Authoriza the user with Google Drive.
   * @param {Object} auth Passed `auth` object to create / update functions.
   * @return {Promise} Promise resolved to token info object.
   */
  auth(auth) {
    let p;
    if (auth) {
      if (auth.accessToken) {
        p = Promise.resolve(auth);
      } else {
        p = Oauth2Identity.launchWebAuthFlow(auth);
      }
    }
    if (!p) {
      p = Oauth2Identity.getAuthToken({interactive: true});
    }
    return p;
  }

  _listAppFoldersHandler(e, requestId, opts) {
    if (this.cachedFolders) {
      e.sender.send('google-drive-operation-result', requestId, this.cachedFolders);
      return;
    }
    if (!opts) {
      opts = {};
    }
    const interactive = typeof opts.interactive === 'undefined' ? true : opts.interactive;
    this.listAppFolders(interactive)
    .then((result) => {
      const folders = [];
      if (result.files) {
        result.files.forEach((item) => {
          folders[folders.length] = {
            id: item.id,
            name: item.name
          };
        });
      }
      this.cachedFolders = folders;
      e.sender.send('google-drive-operation-result', requestId, folders);
    })
    .catch((cause) => {
      if (cause instanceof Error) {
        cause = {
          message: cause.message
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    });
  }
  /**
   * Lists folders in Google Drive.
   * With regular set of authorization scopes this function lists folders creaded by this application.
   * With additional scopes it will list all folders.
   * ARC uses default set of scopes meaning it will only list folders
   * previously created by it (as ling as OAuth client id is the same).
   * @param {Boolean} interactive Perform interactive authorization. When false it will not bring
   * oauth screen when application is not authorized.
   * @return {Promise} Promise resolved to Drive response.
   */
  listAppFolders(interactive) {
    return Oauth2Identity.getAuthToken({interactive})
    .then((auth) => {
      if (auth) {
        return this._listAppFolders(auth);
      }
    });
  }

  _listAppFolders(auth) {
    const params = {
      q: 'trashed = false and mimeType="application/vnd.google-apps.folder"',
      orderBy: 'modifiedTime desc'
    };
    let url = 'https://www.googleapis.com/drive/v3/files?';
    Object.keys(params).forEach((key) => {
      url += key + '=' + encodeURIComponent(params[key]) + '&';
    });
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url
      });
      request.setHeader('authorization', 'Bearer ' + auth.accessToken);
      request.setHeader('accept', 'application/json');
      request.on('response', (response) => {
        let body = [];
        response.on('data', (chunk) => {
          body.push(chunk);
        });
        response.on('end', () => {
          body = Buffer.concat(body).toString();
          try {
            body = JSON.parse(body);
          } catch (e) {
            reject(e);
            return;
          }
          if (body.error) {
            reject(new Error(body.message));
          } else {
            resolve(body);
          }
        });
      });
      request.on('error', (error) => {
        reject(error);
      });
      request.end();
    });
  }
  /**
   * Creates a Google Drive File.
   *
   * If `config.resource.mimeType` is not set and `drive.file.mime` is set then
   * `this.mime` is used instead.
   *
   * This script will automatically set file thumbnail if not set
   * (`config.resource.contentHints.thumbnail` object value).
   *
   * @param {Object} resource File metadata.
   * @param {Object} media A data to send with content type.
   * - {String} `mimeType` - A media mime type
   * - {String} `body` - A content to save.
   * @param {?Object} auth Authorization data to use:
   * - `{Object}` `auth` - Authorization data to use. If it contains `accessToken`
   * property it will skip authorization and use this token. Otherwise it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise} Promise resolved to Drive response object.
   */
  create(resource, media, auth) {
    if (!resource.mimeType && this.mime) {
      resource.mimeType = this.mime;
    }
    let createdParents;
    let token;
    return this.auth(auth)
    .then((info) => {
      token = info.accessToken;
      let p;
      if (resource.parents && resource.parents.length) {
        p = this.createParents(resource.parents, info);
      } else {
        p = Promise.resolve();
      }
      return p;
    })
    .then((parents) => {
      if (!parents || !parents.length) {
        delete resource.parents;
      }
      if (parents) {
        createdParents = parents;
        resource.parents = parents.map((item) => item.id);
      }
      return this._initializeSession(token, resource)
      .then((url) => this._upload(token, url, media.body, media.mimeType))
      .then((result) => {
        if (createdParents) {
          result.parents = createdParents;
        }
        return result;
      });
    });
  }
  /**
   * Update a file on Google Drive.
   *
   * @param {String} fileId A Google Drive file ID.
   * @param {Object} resource The same as for `create` function.
   * @param {Object} media The same as for `create` function.
   * @param {?Object} auth The same as for `create` function.
   * @return {Promise} Fulfilled promise with file properties (the response).
   */
  update(fileId, resource, media, auth) {
    if (!resource.mimeType && this.mime) {
      resource.mimeType = this.mime;
    }
    return this.auth(auth)
    .then((info) => {
      const token = info.accessToken;
      return this._initializeSession(token, resource, fileId)
      .then((url) => this._upload(token, url, media.body, media.mimeType));
    });
  }
  /**
   * Initializes resumable session to upload a file to Google Drive.
   * @param {String} token Authorization token
   * @param {?Object} meta Optional file meta data to send with the request
   * @param {?String} fileId If it is the update request, this is file id to update
   * @return {Promise}
   */
  _initializeSession(token, meta, fileId) {
    let url = 'https://www.googleapis.com/upload/drive/v3/files';
    let method;
    if (fileId) {
      url += `/${fileId}?uploadType=resumable`;
      method = 'PATCH';
    } else {
      url += '?uploadType=resumable';
      method = 'POST';
    }
    return new Promise((resolve, reject) => {
      const request = net.request({
        method,
        url
      });
      const body = meta ? JSON.stringify(meta) : undefined;
      request.setHeader('authorization', 'Bearer ' + token);
      request.setHeader('Content-Type', 'application/json; charset=UTF-8');
      request.on('response', (response) => {
        if (response.statusCode >= 400) {
          let body = [];
          response.on('data', (chunk) => {
            body.push(chunk);
          });
          response.on('end', () => {
            body = Buffer.concat(body).toString();
            let msg = 'Could not initialize Drive upload session. Reason: ';
            msg += body;
            reject(new Error(msg));
          });
          return;
        }
        const result = response.headers.location;
        if (result) {
          resolve(result instanceof Array ? result[0] : result);
          response.destroy();
        } else {
          reject(new Error('Could not initialize Drive upload session.'));
        }
      });
      request.on('error', (error) => {
        reject(error);
      });
      request.write(body);
      request.end();
    });
  }
  /**
   * Uploads the file to the upload endpoint.
   * The `url` is received from the Drive upload location of the upload for
   * the resource.
   * @param {String} token
   * @param {String} url
   * @param {String} body
   * @param {String} mimeType
   * @return {Promise}
   */
  _upload(token, url, body, mimeType) {
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'PUT',
        url
      });
      request.setHeader('authorization', 'Bearer ' + token);
      request.setHeader('content-type', mimeType);
      request.on('response', (response) => {
        let body = [];
        response.on('data', (chunk) => {
          body.push(chunk);
        });
        response.on('end', () => {
          body = Buffer.concat(body).toString();
          try {
            body = JSON.parse(body);
          } catch (e) {
            reject(e);
            return;
          }
          resolve(body);
        });
      });
      request.on('error', (error) => {
        reject(error);
      });
      request.write(body);
      request.end();
    });
  }
  /**
   * Creates a list of folders in Google Drive.
   * It expects the input list to be array of `string` as a list of names of
   * folders to create or array of objects with `name` and optional `id` properties.
   * If the item on the array already have `id` the folder won't be created.
   *
   * The resulting list will contain list of objects with `name` and `id`.
   *
   * @param {Array<String>|Array<Object>} parents
   * @param {?Object} auth Authorization data to use:
   * - `{Object}` `auth` - Authorization data to use. If it contains `accessToken`
   * property it will skip authorization and use this token. Otherwise it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise<Array<Object>>}
   */
  createParents(parents, auth) {
    if (!parents || !parents.length) {
      return Promise.reject(new Error('The parents argument not set.'));
    }
    parents = this._normalizeParents(parents);
    if (!parents.length) {
      return Promise.resolve([]);
    }
    return this.auth(auth)
    .then((info) => {
      return this._createParents(parents, info, []);
    });
  }

  _normalizeParents(parents) {
    const result = [];
    parents.forEach((item) => {
      if (typeof item === 'string') {
        if (name.toLowerCase() === 'my drive') {
          result[result.length] = {id: 'root'};
        }
      } else {
        if (!item.name && !item.id) {
          return;
        }
        result[result.length] = item;
      }
    });
    return result;
  }

  _createParents(parents, auth, result) {
    const parent = parents.shift();
    if (!parent) {
      return Promise.resolve(result);
    }
    if (parent.id) {
      result.push(parent);
      return this._createParents(parents, auth, result);
    }
    return this.createFolder(parent.name, auth)
    .then((id) => {
      parent.id = id;
      result.push(parent);
      if (!this.cachedFolders) {
        this.cachedFolders = [];
      }
      this.cachedFolders.push(parent);
      return this._createParents(parents, auth, result);
    });
  }
  /**
   * Creates a Google Drive folder.
   *
   * @param {String} name Folder name
   * @param {?Object} auth Authorization data to use:
   * - `{Object}` `auth` - Authorization data to use. If it contains `accessToken`
   * property it will skip authorization and use this token. Otherwise it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise} Promise resolved to created folder ID.
   */
  createFolder(name, auth) {
    return this.auth(auth)
    .then((info) => {
      const token = info.accessToken;
      return this._createFolder(name, token);
    });
  }

  _createFolder(name, token) {
    const url = 'https://content.googleapis.com/drive/v3/files?alt=json';
    const mimeType = 'application/vnd.google-apps.folder';
    const body = JSON.stringify({
      name,
      mimeType
    });
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url
      });
      request.setHeader('authorization', 'Bearer ' + token);
      request.setHeader('content-type', 'application/json');
      request.on('response', (response) => {
        let body = [];
        response.on('data', (chunk) => {
          body.push(chunk);
        });
        response.on('end', () => {
          body = Buffer.concat(body).toString();
          try {
            body = JSON.parse(body);
          } catch (e) {
            reject(e);
            return;
          }
          if (body.error) {
            reject(new Error(body.message));
          } else {
            resolve(body.id);
          }
        });
      });
      request.on('error', (error) => {
        reject(error);
      });
      request.write(body);
      request.end();
    });
  }

  _getFileHandler(e, requestId, id) {
    this.getFile(id)
    .then((result) => {
      e.sender.send('google-drive-operation-result', requestId, result);
    })
    .catch((cause) => {
      if (cause instanceof Error) {
        cause = {
          message: cause.message
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    });
  }
  /**
   * Downloads the file data by given ID.
   * @param {String} id File ID
   * @return {Promise} Promise resolved to file's string data.
   */
  getFile(id) {
    return this.auth()
    .then((auth) => this._downloadFile(auth, id));
  }

  _downloadFile(auth, id) {
    const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url
      });
      request.setHeader('authorization', 'Bearer ' + auth.accessToken);
      request.on('response', (response) => {
        let isError = false;
        if (response.statusCode >= 400) {
          isError = true;
        }
        let body = [];
        response.on('data', (chunk) => {
          body.push(chunk);
        });
        response.on('end', () => {
          body = Buffer.concat(body).toString();
          if (isError) {
            try {
              let tmp = JSON.parse(body);
              if (tmp.error) {
                tmp = tmp.error;
              }
              if (tmp.message) {
                body = (tmp.code ? (String(tmp.code) + ': ') : '') + tmp.message;
              }
              console.log(body);
            } catch (_) {}
            reject(new Error(body));
          } else {
            resolve(body);
          }
        });
      });
      request.on('error', (error) => {
        reject(error);
      });
      request.end();
    });
  }
}
module.exports.DriveExport = DriveExport;
