# Google Drive integration for ARC electron app

This module is used in ARC electron app. It integrates the application with Google
Drive.

## Usage

```
$ npm i @advanced-rest-client/electron-drive
```

In the main process:

```javascript
const {DriveExport} = require('@advanced-rest-client/electron-drive');
const drive = new DriveExport();
drive.listen();
```

In renderer process

```javascript
const {ipcRenderer} = require('electron');

const requestId = 'An id to recognize the request in event based environment';
const body = {
  property: 'value'
};
const id = undefined; // This is optional, used when updating a file
const auth = undefined; // This is optional, see below for details
ipcRenderer.send('google-drive-data-save', requestId, {
  meta: {
    name: 'file-name.json',
    description: 'My test file',
  },
  body,
  type: 'application/json', // File (content) media type
  id,
  auth
});
ipcRenderer.on('google-drive-data-save-result', (e, id, result) => {
  if (id !== requestId) {
    return;
  }
  console.log(result);
  // {
  //  "id": "12He6_8aBxpCRaF1x5Nlwv35SWiKJBwkp"
  //  "kind": "drive#file",
  //  "mimeType": "application/json",
  //  "name": "file-name.json"
  // }
});
ipcRenderer.on('google-drive-data-save-error', (e, id, cause) => {
  if (id !== requestId) {
    return;
  }
  console.error(cause);
});
```

## Updating the file

Just pass the `id` property to the event configuration object. The id is the
id of the file created in the Drive.

## Authorization

The library uses [@advanced-rest-client/electron-oauth2](https://www.npmjs.com/package/@advanced-rest-client/electron-oauth2)
for authentication. By default it reads configuration from the `package.json`
file and looks for `oauth2` key with OAuth 2 configuration. The `google-drive-data-save`
accepts `auth` property on the configuration object which accepts the same
configuration as for `electron-oauth2` `launchWebAuthFlow()` function.

If the application already has valid auth token for Google Drive, pass it
to the `auth` object so the library skip the authorization process:

```javascript
const config = {
  ...
  auth: {
    accessToken: 'my token'
  }
};
const requestId = 'abcd';
ipcRenderer.send('google-drive-data-save', requestId, config);
```
