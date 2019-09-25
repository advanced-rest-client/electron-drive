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

import { Oauth2Identity } from '@advanced-rest-client/electron-oauth2';
import { ipcMain, net } from 'electron';
/**
 * A class that is responsible for exporting data to Google Drive.
 * The class is to be used with the main process.
 */
export class DriveExport {
  /**
   * @type {Object} Default configuration for Advanced REST Client.
   */
  static get arcDefaults() {
    return {
      mime: 'application/restclient+data',
      fileDescription: 'Advanced REST client data export file.',
      fileType: 'application/json',
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
    ipcMain.removeListener('google-drive-list-app-folders',
        this._listAppFoldersHandler);
    ipcMain.removeListener('google-drive-get-file', this._getFileHandler);
  }
  /**
   * Handler for `google-drive-data-save` event emmited by the renderer proccess
   *
   * @param {Event} e
   * @param {String} requestId Arbitrary string to report back with the response
   * @param {Object} config Request configuration data:
   * - `{Object}` `meta` - Google Drive file resource values.
   * See Google Drive API documentation for details.
   * - `{String|Object}` `body` - File data. Objects are serialized to JSON.
   * - `{String}` `type` - File content type. Defaults to `application/json`
   * - `{String}` `id` - Existing Drive file id. If present the file is being
   * updated.
   * - `{Object}` `auth` - Authorization data to use. If it contains
   * `accessToken` property it will skip authorization and use this token.
   * Otherwise it expects `@advanced-rest-client/electron-oauth2`
   * configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   */
  async _dataSaveHandler(e, requestId, config) {
    const { auth, id } = config;
    const meta = this._createResource(config);
    const media = this._createMedia(config);
    try {
      let result;
      if (id) {
        result = await this.update(id, meta, media, auth);
      } else {
        result = await this.create(meta, media, auth);
      }
      e.sender.send('google-drive-operation-result', requestId, result);
    } catch (cause) {
      if (cause instanceof Error) {
        cause = {
          message: cause.message,
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    }
  }
  /**
   * Creates media data used by this library
   * @param {Object} config Passed user configuration
   * @return {Object} Resource object
   */
  _createMedia(config) {
    let { body, type } = config;
    if (typeof body !== 'string') {
      body = JSON.stringify(body);
    }
    const media = {
      mimeType: type || this.fileType,
      body,
    };
    return media;
  }
  /**
   * Creates resource data for Drive file.
   * @param {Object} config Passed user configuration
   * @return {Object} Resource object
   */
  _createResource(config) {
    let { meta, type } = config;
    if (!meta) {
      meta = {};
    }
    if (!meta.description && this.fileDescription) {
      meta.description = this.fileDescription;
    }
    if (!meta.mimeType) {
      meta.mimeType = type || this.fileType;
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
      p = Oauth2Identity.getAuthToken({ interactive: true });
    }
    return p;
  }
  /**
   * List application created folders as a response to a web event.
   * @param {Event} e Handled event
   * @param {String} requestId
   * @param {Object} opts List options.
   */
  async _listAppFoldersHandler(e, requestId, opts) {
    if (this.cachedFolders) {
      e.sender.send('google-drive-operation-result',
          requestId, this.cachedFolders);
      return;
    }
    if (!opts) {
      opts = {};
    }
    const interactive = typeof opts.interactive === 'undefined' ?
      true : opts.interactive;
    try {
      const result = await this.listAppFolders(interactive);
      const folders = [];
      if (result.files) {
        result.files.forEach((item) => {
          folders[folders.length] = {
            id: item.id,
            name: item.name,
          };
        });
      }
      this.cachedFolders = folders;
      e.sender.send('google-drive-operation-result', requestId, folders);
    } catch (cause) {
      if (cause instanceof Error) {
        cause = {
          message: cause.message,
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    }
  }
  /**
   * Lists folders in Google Drive.
   * With regular set of authorization scopes this function lists folders
   * creaded by this application.
   * With additional scopes it will list all folders.
   * ARC uses default set of scopes meaning it will only list folders
   * previously created by it (as ling as OAuth client id is the same).
   * @param {Boolean} interactive Perform interactive authorization. When
   * false it will not bring
   * oauth screen when application is not authorized.
   * @return {Promise} Promise resolved to Drive response.
   */
  listAppFolders(interactive) {
    return Oauth2Identity.getAuthToken({ interactive })
        .then((auth) => {
          if (auth) {
            return this._listAppFolders(auth);
          }
        });
  }
  /**
   * Implementation for folders listing
   * @param {Object} auth
   * @return {Promise}
   */
  _listAppFolders(auth) {
    const params = {
      q: 'trashed = false and mimeType="application/vnd.google-apps.folder"',
      orderBy: 'modifiedTime desc',
    };
    let url = 'https://www.googleapis.com/drive/v3/files?';
    Object.keys(params).forEach((key) => {
      url += key + '=' + encodeURIComponent(params[key]) + '&';
    });
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url,
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
   * - `{Object}` `auth` - Authorization data to use. If it contains
   * `accessToken`
   * property it will skip authorization and use this token. Otherwise
   * it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise} Promise resolved to Drive response object.
   */
  async create(resource, media, auth) {
    if (!resource.mimeType && this.mime) {
      resource.mimeType = this.mime;
    }
    const info = await this.auth(auth);
    const token = info.accessToken;
    let createdParents;
    if (resource.parents && resource.parents.length) {
      createdParents = await this.createParents(resource.parents, info);
      if (!createdParents || !createdParents.length) {
        delete resource.parents;
      } else {
        resource.parents = createdParents.map((item) => item.id);
      }
    }
    const url = await this._initializeSession(token, resource);
    const result = await this._upload(token, url, media.body, media.mimeType);
    if (createdParents) {
      result.parents = createdParents;
    }
    return result;
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
  async update(fileId, resource, media, auth) {
    if (!resource.mimeType && this.mime) {
      resource.mimeType = this.mime;
    }
    const info = await this.auth(auth);
    const token = info.accessToken;
    const url = await this._initializeSession(token, resource, fileId);
    return await this._upload(token, url, media.body, media.mimeType);
  }
  /**
   * Initializes resumable session to upload a file to Google Drive.
   * @param {String} token Authorization token
   * @param {?Object} meta Optional file meta data to send with the request
   * @param {?String} fileId If it is the update request, this is file id
   * to update
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
        url,
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
        url,
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
   * folders to create or array of objects with `name` and optional
   * `id` properties.
   * If the item on the array already have `id` the folder won't be created.
   *
   * The resulting list will contain list of objects with `name` and `id`.
   *
   * @param {Array<String>|Array<Object>} parents
   * @param {?Object} auth Authorization data to use:
   * - `{Object}` `auth` - Authorization data to use. If it contains
   * `accessToken`
   * property it will skip authorization and use this token. Otherwise
   * it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise<Array<Object>>}
   */
  async createParents(parents, auth) {
    if (!parents || !parents.length) {
      throw new Error('The parents argument not set.');
    }
    parents = this._normalizeParents(parents);
    if (!parents.length) {
      return [];
    }
    const info = await this.auth(auth);
    return await this._createParents(parents, info, []);
  }
  /**
   * Niormalizes "parents" array to common model.
   * @param {Array} parents
   * @return {Array<Object>}
   */
  _normalizeParents(parents) {
    const result = [];
    parents.forEach((item) => {
      if (typeof item === 'string') {
        if (item.toLowerCase() === 'my drive') {
          result[result.length] = { id: 'root' };
        } else {
          result[result.length] = { name: item };
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
  /**
   * Creates parent folders in Driver API.
   * @param {Array} parents List of parent to create
   * @param {Object} auth Authorization object
   * @param {Array} result A list to insert results to.
   * @return {Promise}
   */
  async _createParents(parents, auth, result) {
    const parent = parents.shift();
    if (!parent) {
      return result;
    }
    if (parent.id) {
      result.push(parent);
      return await this._createParents(parents, auth, result);
    }
    const id = await this.createFolder(parent.name, auth);
    parent.id = id;
    result.push(parent);
    if (!this.cachedFolders) {
      this.cachedFolders = [];
    }
    this.cachedFolders.push(parent);
    return await this._createParents(parents, auth, result);
  }
  /**
   * Creates a Google Drive folder.
   *
   * @param {String} name Folder name
   * @param {?Object} auth Authorization data to use:
   * - `{Object}` `auth` - Authorization data to use. If it contains
   * `accessToken`
   * property it will skip authorization and use this token.
   * Otherwise it expects
   * `@advanced-rest-client/electron-oauth2` configuration object for
   * `Oauth2Identity.launchWebAuthFlow()` function. If the object is not set
   * it uses `Oauth2Identity.getAuthToken()` to get token from the server.
   * It implies "oauth2" configuration in the package.json file.
   * @return {Promise} Promise resolved to created folder ID.
   */
  async createFolder(name, auth) {
    const info = await this.auth(auth);
    const token = info.accessToken;
    return await this._createFolder(name, token);
  }
  /**
   * Makes a request to Drive API to create a folder.
   * @param {String} name Folder name
   * @param {String} token Authorization token.
   * @return {Promise} A promise resolved to created foleder ID.
   */
  _createFolder(name, token) {
    const url = 'https://content.googleapis.com/drive/v3/files?alt=json';
    const mimeType = 'application/vnd.google-apps.folder';
    const body = JSON.stringify({
      name,
      mimeType,
    });
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url,
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
  /**
   * Handler for get file event.
   * @param {Event} e
   * @param {String} requestId
   * @param {String} id File id
   */
  async _getFileHandler(e, requestId, id) {
    try {
      const result = await this.getFile(id);
      e.sender.send('google-drive-operation-result', requestId, result);
    } catch (cause) {
      if (cause instanceof Error) {
        cause = {
          message: cause.message,
        };
      }
      e.sender.send('google-drive-operation-error', requestId, cause);
    }
  }
  /**
   * Downloads the file data by given ID.
   * @param {String} id File ID
   * @return {Promise} Promise resolved to file's string data.
   */
  async getFile(id) {
    const auth = await this.auth();
    return await this._downloadFile(auth, id);
  }
  /**
   * Makes a request to Drive API to downloaid file content.
   * @param {Object} auth Authorization object.
   * @param {String} id File id
   * @return {Promise}
   */
  _downloadFile(auth, id) {
    const url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
    return new Promise((resolve, reject) => {
      const request = net.request({
        method: 'GET',
        url,
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
                body = (tmp.code ? (String(tmp.code) + ': ') : '') +
                  tmp.message;
              }
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
