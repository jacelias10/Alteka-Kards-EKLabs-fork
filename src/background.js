'use strict'

import { app, protocol, BrowserWindow, ipcMain, dialog, shell, screen, nativeTheme } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import compareVersions from 'compare-versions'
const log = require('electron-log')
const { networkInterfaces, hostname } = require('os')
const axios = require('axios')
const Store = require('electron-store')
const path = require('path')
var bonjour = require('bonjour')()
const mime = require('mime-types')

// Project specific includes
const touchBar = require('./touchbar.js')
const fs = require('fs')
const say = require('say')
// var sizeOf = require('image-size')
const wallpaper = require('wallpaper')
import altekaMenu from './menu'
import oscServer from './osc'
import restServer from './rest'

const isDevelopment = process.env.NODE_ENV !== 'production'
const version = require('./../package.json').version

const store = new Store()

//========================//
//         Rollbar        //
//========================//
var Rollbar = require("rollbar")
let env = require('../env.json')
if (!isDevelopment && env.rollbarToken != '') {
  new Rollbar({
    accessToken: env.rollbarToken,
    captureUncaught: true,
    captureUnhandledRejections: true,
    payload: {
      version: version
    }
  })
  // rollbar.debug('Hello World')
}
if (!env.rollbarToken) {
  log.warn('No Rollbar token has been set!')
}


//======================================//
//      BOILER PLATE ELECTRON STUFF     //
//======================================//
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true, stream: true } }
])

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  dialog.showErrorBox("Error", "Another instance of Kards is already running")
  app.quit()
}

process.on('uncaughtException', function (error) {
  if (isDevelopment) {
    dialog.showErrorBox('Unexpected Error', error + '\r\n\r\n' + JSON.stringify(error))
  }
  log.warn('Error: ', error)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    bonjour.unpublishAll()
    bonjour.destroy()
    log.info('All Windows closed - Quitting App')
    rest.stop()
    app.quit()
  }
})

app.on('activate', () => {
  app.whenReady().then(() => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()  
   })
})

app.on('ready', async () => {
  // Optional developer tools must not delay the application window.
  createWindow()
  if (isDevelopment && !process.env.IS_TEST && process.env.OPEN_DEVTOOLS === '1') {
    try {
      await installExtension(VUEJS3_DEVTOOLS)
    } catch (e) {
      log.error('Vue Devtools failed to install:', e.toString())
    }
  }
})

if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        bonjour.unpublishAll()
        bonjour.destroy()
        log.info('OS called for graceful exit - Quitting App')
        rest.stop()
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      bonjour.unpublishAll()
      bonjour.destroy()
      log.info('OS call SIGTERM - Quitting App')
      rest.stop()
      app.quit()
    })
  }
}



//==========================//
//       CONFIG OBJECT      //
//==========================//
let config
app.on('ready', function() {
  log.info('Launching Kards')
  config = {
    ...getDefaultConfig(),
    ...store.get('KardsConfig', getDefaultConfig())
  }
  const savedOutputs = store.get('KardsOutputs', {})
  for (const [id, saved] of Object.entries(savedOutputs)) {
    outputConfigs.set(Number(id), { ...getDefaultConfig(), ...saved, visible: false,
      audio: { ...saved.audio, enabled: false } })
  }
  config.visible = false
  config.audio.enabled = false
  config = outputConfigs.get(config.screen) || config
  outputConfigs.set(config.screen, config)
  log.info('Loaded Config')
  controlMenu.setup(JSON.parse(JSON.stringify(config)))
})
ipcMain.on('config', (_, arg) => {
  // Late renderer updates may belong to the previously selected output.
  if (arg.screen !== config.screen) return
  config = arg
  outputConfigs.set(config.screen, config)
  manageTestCardWindow()
  if (testCardWindow != null) { 
    testCardWindow.webContents.send('config', config)
    if (config.windowed) {
      if (config.window.width > 0) {
        testCardWindow.setContentSize(parseInt(config.window.width), parseInt(config.window.height))
      }
    }
  }
  controlMenu.updateConfig(JSON.parse(JSON.stringify(config)))
  osc.updateConfig(JSON.parse(JSON.stringify(config)))
  rest.updateConfig(JSON.parse(JSON.stringify(config)))
  store.set('KardsConfig', config)
  store.set('KardsOutputs', Object.fromEntries(outputConfigs))
  touchBar.setConfig(config)
  updateScreens()
})
ipcMain.on('getConfigTestCard', (event) => {
  const entry = outputForSender(event.sender)
  const cfg = entry ? outputConfigs.get(entry[0]) : config
  event.sender.send('config', cfg)
  const display = screen.getAllDisplays().find(display => display.id === cfg.screen)
  if (display) event.sender.send('displayFrequency', display.displayFrequency)
})

ipcMain.on('getConfigControl', () => {
  controlWindow.webContents.send('config', config)
  controlWindow.webContents.send('darkMode', nativeTheme.shouldUseDarkColors)
})

ipcMain.on('aboutDialogInfo', () => {
  let about = {
    version: version,
    electron: process.versions.electron,
    node: process.versions.node,
    vue: require('vue/package.json').version
  }
  controlWindow.webContents.send('aboutDialogInfo', about)
})


ipcMain.on('resetDefault', () => {
  controlWindow.webContents.send('config', { ...getDefaultConfig(), screen: config.screen })
  resetAudio()
})

function getDefaultConfig() {
  let defaultConfig = JSON.parse(JSON.stringify(require('./defaultConfig.json')))
  defaultConfig.name = hostname().split('.')[0].replace(/([a-z\xE0-\xFF])([A-Z\xC0\xDF])/g, "$1 $2").replace(/-|_|\.|\||\+|=|~|<|>|\/|\\/g, ' ')
  defaultConfig.screen = screen.getPrimaryDisplay().id
  return defaultConfig
}





//==========================//
//       WINDOW HANDLER     //
//==========================//
let controlWindow
let shuttingDown = false
app.on('before-quit', () => { shuttingDown = true })
let testCardWindow
const outputConfigs = new Map()
const outputWindows = new Map()

function getOutputWindow(id) {
  const entry = outputWindows.get(id)
  return entry ? entry.window : null
}

function outputForSender(sender) {
  return [...outputWindows].find(([, entry]) => entry.window.webContents === sender)
}

ipcMain.on('selectOutput', (_, id) => selectOutput(id))

function selectOutput(id) {
  if (!screen.getAllDisplays().some(display => display.id === id)) return
  if (!outputConfigs.has(id)) {
    const fresh = getDefaultConfig()
    fresh.screen = id
    fresh.audio.enabled = false
    outputConfigs.set(id, fresh)
  }
  config = outputConfigs.get(id)
  testCardWindow = getOutputWindow(id)
  controlMenu.updateConfig(JSON.parse(JSON.stringify(config)))
  osc.updateConfig(JSON.parse(JSON.stringify(config)))
  rest.updateConfig(JSON.parse(JSON.stringify(config)))
  touchBar.setConfig(config)
  controlWindow.webContents.send('config', config)
  updateScreens()
}
var controlMenu = new altekaMenu()

controlMenu.on('menuClick', (c) => {
  if (c.screen !== config.screen) { selectOutput(c.screen); return }
  controlWindow.webContents.send('config', c)
})
controlMenu.on('loadAudioFile', () => {
  loadAudioFile()
})
controlMenu.on('openLogs', () => {
  openLogs()
})
controlMenu.on('aboutDialog', () => {
  controlWindow.webContents.send('aboutDialog') 
})

async function createWindow() {
  log.info('Showing control window')
  controlWindow = new BrowserWindow({
    width: 620,
    height: 450,
    show: false,
    useContentSize: true,
    maximizable: false,
    title: "Kards",
    resizable: false,
    webPreferences: {
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  controlWindow.once('ready-to-show', () => {
    controlWindow.show()
  })

  controlWindow.on('closed', () => {
    shuttingDown = true
    log.info('Control Window closed - Quitting App')
    rest.stop()
    app.quit()
  })

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    await controlWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST && process.env.OPEN_DEVTOOLS === '1') controlWindow.webContents.openDevTools()
  } else {
    createProtocol('app')
    controlWindow.loadURL('app://./index.html')
  }

  controlWindow.setTouchBar(touchBar.touchBar)
  touchBar.setWindow(controlWindow)
}
ipcMain.on('controlResize', (_, data) => {
  controlWindow.setContentSize(675, data.height)
})


//========================//
//   Screen Management    //
//========================//
let screens
let primaryScreen

function updateScreens() {
  screens = screen.getAllDisplays()
  primaryScreen = screen.getPrimaryDisplay().id

  // workaround for Electron's displayFrequency being rounded.
  for (const s in screens) {
    if (screens[s].displayFrequency == 59) {
      screens[s].displayFrequency = 59.94
    }
    if (screens[s].displayFrequency == 29) {
      screens[s].displayFrequency = 29.97
    }
    screens[s].displayFrequency = Math.round(screens[s].displayFrequency*100)/100 // force elegant rounding 
  }

  if (controlWindow != null) {
    controlWindow.webContents.send('screens', {all: screens, primary: primaryScreen})  
    controlMenu.updateScreens(screens)
    rest.updateScreens(screens)
    osc.updateScreens(screens)
  }
  for (const [id, entry] of outputWindows) {
    const display = screens.find(display => display.id === id)
    if (display) {
      entry.window.webContents.send('displayFrequency', display.displayFrequency)
      if (!entry.windowed && !entry.exportOnly) entry.window.setBounds(display.bounds)
    }
    else {
      outputWindows.delete(id)
      entry.window.destroy()
      outputConfigs.get(id).visible = false
    }
  }
  if (config && !screens.some(display => display.id === config.screen)) {
    config = outputConfigs.get(primaryScreen) || { ...getDefaultConfig(), screen: primaryScreen }
    outputConfigs.set(primaryScreen, config)
    controlWindow.webContents.send('config', config)
  }
  testCardWindow = getOutputWindow(config && config.screen)
  if (config) store.set('KardsOutputs', Object.fromEntries(outputConfigs))
  if (controlWindow && config) controlWindow.webContents.send('outputStates',
    Object.fromEntries([...outputConfigs].map(([id, cfg]) => [id, cfg.visible])))
}
ipcMain.on('getScreens', () => {
  updateScreens()
})
app.on('ready', function() {
  updateScreens()

  screen.on('display-added', function() {
    setTimeout(updateScreens, 500)
  })
  screen.on('display-removed', function() {
    setTimeout(updateScreens, 500)
  })
  screen.on('display-metrics-changed', function() {
    setTimeout(updateScreens, 500)
  })
})




// app.on('ready', async () => {
// })


//========================//
//       IPC Handlers     //
//========================//
ipcMain.on('closeTestCard', (event) => {
  const entry = outputForSender(event.sender)
  const id = entry ? entry[0] : config.screen
  const cfg = outputConfigs.get(id)
  if (!cfg) return
  cfg.visible = false
  const target = outputWindows.get(id)
  if (target) {
    outputWindows.delete(id)
    target.window.destroy()
  }
  if (id === config.screen) {
    testCardWindow = null
    controlWindow.webContents.send('config', cfg)
  }
  updateScreens()
})

ipcMain.on('openLogs', () => {
  openLogs()
})

function openLogs() {
  const path = log.transports.file.findLogPath()
  shell.showItemInFolder(path)
}

ipcMain.on('openUrl', (_, arg) => {
  shell.openExternal(arg)
  log.info('open url', arg)
})

ipcMain.on('selectMaskImage', () => {
  let result = dialog.showOpenDialogSync({ title: "Select Image", properties: ['openFile'], filters: [{name: 'Images', extensions: ['jpeg', 'jpg', 'png', 'gif', 'svg']}] })
  if (result != null) {
    let data = fs.readFileSync(result[0], { encoding: 'base64' })
    config.mask.imageSource = 'data:' + mime.lookup(result[0]) + ';base64,' + data
    config.mask.enabled = true // enable when image is picked.
    controlWindow.webContents.send('config', config)
  } else {
    log.info('No file selected')
  }
})

ipcMain.on('networkInfo', (event) => {
  const nets = networkInterfaces();
  const results = ['Kards v' + version, hostname().split('.')[0]]

  for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
          if (net.family === 'IPv4' && !net.internal) {
              results.push(name + ': ' + net.address)
          }
      }
  }
  event.sender.send('networkInfo', results)
})





//==========================//
//   Test Card Management   //
//==========================//
// called when config is updated
function manageTestCardWindow() {
  const id = config.screen
  let entry = outputWindows.get(id)
  if (entry && entry.exportOnly) return
  if (entry && (!config.visible || entry.windowed !== config.windowed)) {
    outputWindows.delete(id)
    entry.window.destroy()
    entry = null
  }
  if (!entry && config.visible) setupNewTestCardWindow()
  testCardWindow = getOutputWindow(id)
  if (testCardWindow) testCardWindow.setResizable(config.windowed && config.cardType !== 'led')
}

function setupNewTestCardWindow() {
  const display = screen.getAllDisplays().find(display => display.id === config.screen)
  if (!display) return
  const bounds = config.windowed ? {
    x: Math.round(display.bounds.x + (display.bounds.width - config.window.width) / 2),
    y: Math.round(display.bounds.y + (display.bounds.height - config.window.height) / 2),
    width: config.window.width, height: config.window.height
  } : display.bounds
  showTestCardWindow({ title: 'Kards - Output', show: false, frame: false,
    ...bounds, fullscreen: !config.windowed,
    simpleFullscreen: process.platform === 'darwin' && !config.windowed,
    roundedCorners: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') } })
}

function showTestCardWindow(windowConfig) {
  const id = config.screen
  const win = new BrowserWindow(windowConfig)
  const entry = { window: win, windowed: config.windowed, resizeTimer: null, exportOnly: headlessExportMode }
  headlessExportMode = false
  outputWindows.set(id, entry)
  testCardWindow = win
  win.on('closed', () => {
    clearTimeout(entry.resizeTimer)
    if (shuttingDown) return
    if (outputWindows.get(id) !== entry) return
    outputWindows.delete(id)
    const cfg = outputConfigs.get(id)
    cfg.visible = false
    if (config.screen === id) {
      testCardWindow = null
      controlWindow.webContents.send('config', cfg)
    }
    updateScreens()
  })
  win.once('ready-to-show', () => {
    if (outputConfigs.get(id) && outputConfigs.get(id).visible && !entry.exportOnly && !win.isDestroyed()) win.showInactive()
  })
  win.on('resize', () => {
    clearTimeout(entry.resizeTimer)
    entry.resizeTimer = setTimeout(() => {
      const cfg = outputConfigs.get(id)
      if (!cfg.windowed || win.isDestroyed()) return
      const [width, height] = win.getContentSize()
      if (cfg.window.width === width && cfg.window.height === height) return
      cfg.window = { width, height }
      if (config.screen === id) controlWindow.webContents.send('config', cfg)
      win.webContents.send('config', cfg)
    }, 500)
  })
  if (process.env.WEBPACK_DEV_SERVER_URL) win.loadURL(process.env.WEBPACK_DEV_SERVER_URL + '#/testcard')
  else win.loadURL('app://./index.html#testcard')
}


//========================//
//    Setup OSC Server    //
//========================//
let osc = new oscServer()
app.on('ready', function() {
  osc.setup()
})
osc.on('updateConfig', (c) => {
  if (c.screen !== config.screen) { selectOutput(c.screen); return }
  controlWindow.webContents.send('config', c)
})
osc.on('audioFile', (filePath) => {
  log.debug('Audio File!', filePath)
  if (fs.lstatSync(filePath).isFile()) {
    config.audio.fileData = 'data:audio/' + filePath.split('.').pop() + ';base64,' + fs.readFileSync(filePath, {encoding: 'base64'})
    config.audio.fileName = 'Opened ' + filePath
    controlWindow.webContents.send('config', config)
  } else {
    log.warning("Selected audio file does not exist")
  }
})


let rest = new restServer()
app.on('ready', function() {
  rest.setup()
})
rest.on('updateConfig', (c) => {
  if (c.screen !== config.screen) { selectOutput(c.screen); return }
  controlWindow.webContents.send('config', c)
})

//========================//
//   Export PNG Images    //
//========================//
let headlessExportMode = false

ipcMain.on('testCardKeyPress', (event, msg) => {
  if (!['windowed', 'animated', 'showInfo', 'showClock', 'raster'].includes(msg)) return
  const entry = outputForSender(event.sender)
  if (entry && entry[0] !== config.screen) {
    const cfg = outputConfigs.get(entry[0])
    cfg[msg] = !cfg[msg]
    // Reconcile using the output's own settings, then restore the editor selection.
    const selected = config
    config = cfg
    manageTestCardWindow()
    if (getOutputWindow(entry[0])) getOutputWindow(entry[0]).webContents.send('config', cfg)
    config = selected
    testCardWindow = getOutputWindow(config.screen)
    updateScreens()
    return
  }
  config[msg] = !config[msg]
  controlWindow.webContents.send('config', config)
  if (testCardWindow != null) {
    testCardWindow.webContents.send('config', config)
  }
})

ipcMain.on('exportCard', () => {
  if (testCardWindow != null) {
    testCardWindow.webContents.send('exportCard')
  } else {
    headlessExportMode = true
    let c = {show: false, frame: false, width: config.window.width, height: config.window.height, webPreferences: {preload: path.join(__dirname, 'preload.js')}}

    if (config.windowed) {
      c.minWidth = config.window.width
      c.minHeight = config.window.height
    } else {
      for (const disp of screen.getAllDisplays()) {
        if (disp.id == config.screen) {
          c.width = disp.bounds.width
          c.height = disp.bounds.height
          c.minWidth = disp.bounds.width
          c.minHeight = disp.bounds.height
        }
      }
    } 
    showTestCardWindow(c) 
    log.info('Creating dummy test card window to capture image')
  }
})

ipcMain.on('selectImage', () => {
  let result = dialog.showOpenDialogSync({ title: "Select Image", properties: ['openFile'], filters: [{name: 'Images', extensions: ['jpeg', 'jpg', 'png', 'gif']}] })
  if (result != null) {
    let data = fs.readFileSync(result[0], { encoding: 'base64' })
    config.alteka.logo = 'data:' + mime.lookup(result[0]) + ';base64,' + data
    controlWindow.webContents.send('config', config)
  } else {
    log.info('No file selected')
  }
})

ipcMain.on('saveAsPNG', (event, arg) => {
  const source = outputForSender(event.sender)
  const exportConfig = source ? outputConfigs.get(source[0]) : config
  headlessExportMode = false
  let suffix = exportConfig.cardType[0].toUpperCase() + exportConfig.cardType.slice(1)
  if (suffix == 'Placeholder') suffix = 'Name'
  if (suffix == 'Led') suffix = 'LED'
  var name = exportConfig.name.replace(/ /g,"-") + '-' + suffix + 'Kard.png'
  dialog.showSaveDialog(controlWindow, {title: 'Save PNG', defaultPath: name, filters: [{name: 'Images', extensions: ['png']}]}).then(result => {
    if (!result.canceled) {
      var base64Data = arg.replace(/^data:image\/png;base64,/, "")
      fs.writeFile(result.filePath, base64Data, 'base64', function(err) {
        if (err) {
          dialog.showErrorBox('Error Saving File', JSON.stringify(err))
          log.error('Couldnt save file: ', err)
          controlWindow.webContents.send('exportCardCompleted', 'Could Not Write File')
        } else {
          // let dims = sizeOf(result.filePath)
          controlWindow.webContents.send('exportCardCompleted')
        }
      })
    } else {
      log.info('Save dialog closed')
      controlWindow.webContents.send('exportCardCompleted', 'File Save Cancelled')
    }
  })
  if (source && source[1].exportOnly) source[1].window.close()
})

ipcMain.on('setAsWallpaper', (event, arg) => {
  const source = outputForSender(event.sender)
  headlessExportMode = false
  let dest = app.getPath('userData') + '/wallpaper' + Math.round((Math.random()*100000)) + '.png'
  var base64Data = arg.replace(/^data:image\/png;base64,/, "")
  fs.writeFile(dest, base64Data, 'base64', err => {
    if (err) {
      dialog.showErrorBox('Error Saving Wallpaper', JSON.stringify(err))
      log.error('Couldnt save wallpaper file ', err)
      controlWindow.webContents.send('exportCardCompleted', 'Could not write temporary file')
      return
    }
    (async () => {
      await wallpaper.set(dest)
      controlWindow.webContents.send('exportCardCompleted')
      })();
    })
    if (source && source[1].exportOnly) source[1].window.close()
  })







//========================//
//    Voice Generation    //
//========================//
ipcMain.on('createVoice', () => {
  createVoice()
})
ipcMain.on('updateAudioText', () => {
  createTextAudio()
})
ipcMain.on('loadAudioFile', () => {
  loadAudioFile()
})
function resetAudio() {
  setTimeout(createVoice, 5000)
  setTimeout(createTextAudio, 5000)
}

function createVoice() {
  let dest = app.getPath('userData') + '/voice.wav'  
  let voice = config.audio.prependText + config.name 

  say.export(voice, null, null, dest, (err) => {
    if (err) {
      return log.error(err)
    }
    log.info('Audio :: Updated name (' + config.name + ') has been saved to ', dest)
    config.audio.voiceData = 'data:audio/wav;base64,' + fs.readFileSync(dest, {encoding: 'base64'})
    controlWindow.webContents.send('config', config)
  })
}

function createTextAudio() {
  let dest = app.getPath('userData') + '/text.wav'  
  say.export(config.audio.text, null, null, dest, (err) => {
    if (err) {
      return log.error(err)
    }
    log.info('Audio :: Updated audio text (' + config.audio.text + ') has been saved to ', dest)
    config.audio.textData = 'data:audio/wav;base64,' + fs.readFileSync(dest, {encoding: 'base64'})
    controlWindow.webContents.send('config', config)
  })
}

function loadAudioFile() {
  dialog.showOpenDialog(controlWindow, {title: 'Open Audio File', filters: [{name: "Audio", extensions: ['wav', 'mp3', 'ogg', 'aac']}]}).then(result => {
    if (!result.canceled) {
      let path = result.filePaths[0]
      config.audio.fileData = 'data:audio/' + path.split('.').pop() + ';base64,' + fs.readFileSync(path, {encoding: 'base64'})
      config.audio.fileName = 'Opened ' + path
      controlWindow.webContents.send('config', config)
      log.info('Audio :: Audio file imported - ' + path)
    } else {
      log.info('Audio :: Save dialog closed')
    }
  })
}


//============================//
//   Import/Export Settings   //
//============================//
ipcMain.on('exportSettings', () => {
  exportSettings()
})

ipcMain.on('importSettings', () => {
  importSettings()
})

controlMenu.on('importSettings', () => {
  importSettings()
})

controlMenu.on('exportSettings', () => {
  exportSettings()
})

function exportSettings() {
  dialog.showSaveDialog({title: 'Export Settings', buttonLabel: 'Export', defaultPath: 'KardsSettings.json', filters: [{extensions: ['json']}]}).then(result => {
    if (!result.canceled) {
      let path = result.filePath
      let cfg = config
      cfg.audio.voiceData = '' // clear this out as it can be easily rebuilt    
      cfg.audio.textData = '' // clear this out as it can be easily rebuilt    
      cfg.createdBy = 'Kards'
      cfg.exportedVersion = version

      let data = JSON.stringify(cfg, null, 2)

      fs.writeFile(path, data, function(err) {
        if (err) {
          dialog.showErrorBox('Error Saving File', JSON.stringify(err))
          log.error('Couldnt save file: ', err)
        }
      })
    } else {
      log.info('Save dialog closed')
    }
  })
}

function importSettings() {
  let result = dialog.showOpenDialogSync({ title: "Import Settings", properties: ['openFile'], filters: [{name: 'JSON', extensions: ['json', 'JSON']}]})
  if (result != null) {
    fs.readFile(result[0], (err, data) => {
      if (err) throw err;
      let d = JSON.parse(data)
      let count = 0

      if (d.createdBy == 'Kards') {
        if (d.exportedVersion == version) {
          for (let key in config) {
            if (d[key] != undefined && key != 'screen' && key != 'visible' && key != 'exportedVersion' && key != 'createdBy' && typeof d[key] === typeof config[key]) {
              config[key] = d[key]
              count++
            }
          }
          createVoice() // recreate voice data after importing settings.
          createTextAudio() 
          controlWindow.webContents.send('config', config)
          controlWindow.webContents.send('importSettings', 'Imported ' + count + ' settings')
        } else {
          controlWindow.webContents.send('importSettings', 'Skipping - The file is from a different version of Kards')  
        }
      } else {
        controlWindow.webContents.send('importSettings', 'Failed - That file was not made by Kards')
      }
    })
  } else {
    log.info('No file selected')
  }
}

//========================//
//     Update Checker     //
//========================//
setTimeout(function() {
  axios.get('https://api.github.com/repos/alteka/kards/releases/latest')
    .then(function (response) {
      let online = response.data.tag_name
      let status = compareVersions(online, version, '>')
      if (status == 1) { 
        log.info('Update :: A newer version (' + online + ') is available. ' + version + ' currently installed.')
        dialog.showMessageBox(controlWindow, {
          type: 'question',
          title: 'An Update Is Available',
          message: 'Would you like to download version: ' + online,
          buttons: ['Cancel', 'Yes']
        }).then(function (response) {
          if (response.response == 1) {
            shell.openExternal('https://alteka.solutions/kards')
          }
        });
      } else if (status == 0) {
        log.info('Update :: Running latest version - ' + online)
      } else if (status == -1) {
        log.info('Update :: Running a newer version (' + version + ') than is online: ' + online)
      }
    })
    .catch(function (error) {
      log.error(error);
    })
  }, 10000)