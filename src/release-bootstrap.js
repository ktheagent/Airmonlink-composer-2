'use strict';

const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

const BUILD = 16;
const exposurePath = path.join(__dirname, 'ui', 'publishing-exposure.js');
let exposureSourcePromise;

function exposureSource() {
  if (!exposureSourcePromise) {
    exposureSourcePromise = fs.readFile(exposurePath, 'utf8');
  }
  return exposureSourcePromise;
}

async function installExposure(contents) {
  if (!contents || contents.isDestroyed()) return false;
  const source = await exposureSource();
  const guardedSource = `
    (() => {
      if (window.AirmonPublishingExposure?.build === ${BUILD}) {
        window.AirmonPublishingExposure.refresh();
        return true;
      }
      ${source}
      return window.AirmonPublishingExposure?.build === ${BUILD};
    })()
  `;
  const installed = await contents.executeJavaScript(guardedSource, true);
  if (!installed) throw new Error('Build 16 publishing controls did not initialize.');
  return true;
}

function attachExposure(window) {
  const contents = window.webContents;
  const install = () => {
    void installExposure(contents).catch(error => {
      console.error('[publishing-exposure] installation failed:', error);
    });
  };

  contents.on('dom-ready', install);
  contents.on('did-finish-load', install);
  contents.on('did-navigate-in-page', install);
}

app.on('browser-window-created', (_event, window) => attachExposure(window));

require('./bootstrap');
