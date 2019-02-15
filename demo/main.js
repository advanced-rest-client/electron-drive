const {app, BrowserWindow} = require('electron');
const path = require('path');
const {DriveExport} = require('../');
let mainWindow = null;
const drive = new DriveExport(DriveExport.arcDefaults);

function initialize() {
  function createWindow() {
    const windowOptions = {
      width: 1080,
      minWidth: 680,
      height: 840,
      title: app.getName()
    };

    mainWindow = new BrowserWindow(windowOptions);
    mainWindow.loadURL(path.join('file://', __dirname, '/demo.html'));

    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  app.on('ready', () => {
    createWindow();
    drive.listen();
    console.log('Listening for Drive events');
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      createWindow();
    }
  });
}

initialize();
