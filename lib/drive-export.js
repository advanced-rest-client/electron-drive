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
  }
  /**
   * Listens for renderer events.
   */
  listen() {
    ipcMain.on('google-drive-data-save', this._dataSaveHandler);
  }
  /**
   * Remove event listeners from the main IPC
   */
  unlisten() {
    ipcMain.removeListener('google-drive-data-save', this._dataSaveHandler);
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
      e.sender.send('google-drive-data-save-result', requestId, result);
    })
    .catch((cause) => {
      if (cause instanceof Error) {
        cause = {
          message: cause.message
        };
      }
      e.sender.send('google-drive-data-save-error', requestId, cause);
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
        p = Promise.resolve(auth.accessToken);
      } else {
        p = Oauth2Identity.launchWebAuthFlow(auth);
      }
    }
    if (!p) {
      p = Oauth2Identity.getAuthToken({interactive: true});
    }
    return p;
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
   * @param {Object} resource File metadata. See `allowedResource` for allowed
   * configuration set.
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
    return this.auth(auth)
    .then((info) => {
      const token = info.accessToken;
      return this._initializeSession(token, resource)
      .then((url) => this._upload(token, url, media.body, media.mimeType));
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
}
module.exports.DriveExport = DriveExport;
