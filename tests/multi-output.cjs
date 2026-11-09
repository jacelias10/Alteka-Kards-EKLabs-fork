const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const { EventEmitter } = require('node:events')

function setup(saved = {}) {
  const ipcMain = new EventEmitter()
  const app = new EventEmitter()
  app.requestSingleInstanceLock = () => true
  app.quit = () => {}
  const windows = []
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false
      this.webContents = { messages: [], send(channel, value) { this.messages.push([channel, value]) } }
      windows.push(this)
    }
    loadURL() { return Promise.resolve() }
    setTouchBar() {}
    setContentSize(width, height) { this.size = [width, height] }
    getContentSize() { return this.size || [1280, 720] }
    setResizable() {}
    setBounds(bounds) { this.bounds = bounds }
    showInactive() { this.shown = true }
    destroy() { this.destroyed = true; this.emit('closed') }
    close() { this.destroy() }
    isDestroyed() { return this.destroyed }
  }
  const display = (id, x) => ({ id, bounds: { x, y: 0, width: 1920, height: 1080 }, displayFrequency: 60 })
  const screen = new EventEmitter()
  screen.displays = [display(1, 0), display(2, 1920)]
  screen.getAllDisplays = () => screen.displays
  screen.getPrimaryDisplay = () => screen.displays[0]
  class Service extends EventEmitter {
    setup() {} updateConfig() {} updateScreens() {} stop() {}
  }
  class Store {
    get(key, fallback) { return saved[key] === undefined ? fallback : JSON.parse(JSON.stringify(saved[key])) }
    set(key, value) { saved[key] = JSON.parse(JSON.stringify(value)) }
  }
  const touchBar = { setConfig() {}, setWindow() {} }
  const noop = () => {}
  const electron = { app, ipcMain, screen, BrowserWindow, protocol: { registerSchemesAsPrivileged: noop },
    nativeTheme: { shouldUseDarkColors: false } }
  let source = fs.readFileSync('src/background.js', 'utf8')
    .replace(/^import .* from .*$/gm, '')
  const context = vm.createContext({
    app, ipcMain, screen, BrowserWindow, protocol: electron.protocol, nativeTheme: electron.nativeTheme,
    createProtocol: noop, altekaMenu: Service, oscServer: Service, restServer: Service,
    installExtension: noop, VUEJS3_DEVTOOLS: '', compareVersions: noop,
    process: { env: { NODE_ENV: 'production' }, platform: 'linux', versions: {}, on: noop },
    __dirname: '/test', setTimeout: () => 1, clearTimeout: noop,
    require(name) {
      if (name === 'electron-log') return { info: noop, warn: noop }
      if (name === 'os') return { hostname: () => 'Test', networkInterfaces: () => ({}) }
      if (name === 'electron-store') return Store
      if (name === 'bonjour') return () => ({})
      if (name === 'rollbar') return class {}
      if (name === '../env.json') return { rollbarToken: '' }
      if (name === './touchbar.js') return touchBar
      if (name === './defaultConfig.json') return require('../src/defaultConfig.json')
      if (name === './../package.json') return { version: '1.3.1' }
      if (name === 'path') return require('node:path')
      return {}
    }
  })
  vm.runInContext(source, context)
  app.emit('ready')
  const send = (channel, sender, value) => ipcMain.emit(channel, { sender }, value)
  const selected = () => vm.runInContext('config', context)
  const output = id => vm.runInContext(`outputWindows.get(${id})?.window`, context)
  const update = patch => send('config', windows[0].webContents,
    JSON.parse(JSON.stringify({ ...selected(), ...patch })))
  return { context, windows, send, selected, output, update, screen, saved }
}

test('two independent outputs survive selection and edits', () => {
  const h = setup()
  h.update({ visible: true, cardType: 'grid', name: 'Left' })
  const left = h.output(1)
  h.send('selectOutput', h.windows[0].webContents, 2)
  assert.equal(h.selected().visible, false)
  h.update({ visible: true, cardType: 'bars', name: 'Right' })
  const right = h.output(2)
  assert.notEqual(left, right)
  h.send('getConfigTestCard', left.webContents)
  assert.equal(left.webContents.messages.findLast(([c]) => c === 'config')[1].name, 'Left')
  h.send('closeTestCard', left.webContents)
  assert.equal(left.destroyed, true)
  assert.equal(right.destroyed, false)
  assert.equal(h.selected().visible, true)
})

test('switching window mode recreates only that output and leaves it enabled', () => {
  const h = setup()
  h.update({ visible: true })
  const original = h.output(1)
  h.update({ windowed: true })
  assert.equal(original.destroyed, true)
  assert.notEqual(h.output(1), original)
  assert.equal(h.selected().visible, true)
})

test('shortcut in unselected output changes only that output', () => {
  const h = setup()
  h.update({ visible: true })
  const left = h.output(1)
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.update({ visible: true })
  h.send('testCardKeyPress', left.webContents, 'windowed')
  assert.equal(h.selected().screen, 2)
  assert.equal(h.selected().windowed, false)
  assert.equal(h.output(1).options.fullscreen, false)
})

test('disconnect closes only its output and selects a connected monitor', () => {
  const h = setup()
  h.update({ visible: true })
  const left = h.output(1)
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.update({ visible: true })
  const right = h.output(2)
  h.screen.displays = [h.screen.displays[0]]
  h.send('getScreens', h.windows[0].webContents)
  assert.equal(right.destroyed, true)
  assert.equal(left.destroyed, false)
  assert.equal(h.selected().screen, 1)
})

test('late edits from previous selection cannot overwrite another monitor', () => {
  const h = setup()
  h.update({ visible: true, name: 'Left' })
  const previous = JSON.parse(JSON.stringify(h.selected()))
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.send('config', h.windows[0].webContents, { ...previous, name: 'Late edit' })
  assert.equal(h.selected().screen, 2)
  h.send('selectOutput', h.windows[0].webContents, 1)
  assert.equal(h.selected().name, 'Left')
})

test('monitor configurations do not share nested settings', () => {
  const h = setup()
  h.selected().grid.bg = '#123456'
  h.send('selectOutput', h.windows[0].webContents, 2)
  assert.notEqual(h.selected().grid.bg, '#123456')
  h.selected().grid.bg = '#abcdef'
  h.send('selectOutput', h.windows[0].webContents, 1)
  assert.equal(h.selected().grid.bg, '#123456')
})

test('Escape from controller closes selected output only', () => {
  const h = setup()
  h.update({ visible: true })
  const left = h.output(1)
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.update({ visible: true })
  const right = h.output(2)
  h.send('closeTestCard', h.windows[0].webContents)
  assert.equal(right.destroyed, true)
  assert.equal(left.destroyed, false)
})

test('settings survive restart independently while outputs and audio start disabled', () => {
  const h = setup()
  h.update({ visible: true, name: 'Left', cardType: 'grid' })
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.update({ visible: true, name: 'Right', cardType: 'bars' })
  const restarted = setup(h.saved)
  assert.equal(restarted.selected().name, 'Right')
  assert.equal(restarted.selected().visible, false)
  assert.equal(restarted.selected().audio.enabled, false)
  restarted.send('selectOutput', restarted.windows[0].webContents, 1)
  assert.equal(restarted.selected().name, 'Left')
  assert.equal(restarted.selected().cardType, 'grid')
  assert.equal(restarted.selected().visible, false)
})

test('hidden PNG export stays attached to its monitor after selecting another output', () => {
  const h = setup()
  h.update({ name: 'Left export' })
  h.send('exportCard', h.windows[0].webContents)
  const hidden = h.output(1)
  h.send('selectOutput', h.windows[0].webContents, 2)
  h.update({ visible: true })
  h.send('getConfigTestCard', hidden.webContents)
  assert.equal(hidden.webContents.messages.findLast(([c]) => c === 'config')[1].name, 'Left export')
  hidden.emit('ready-to-show')
  h.output(2).emit('ready-to-show')
  assert.equal(hidden.shown, undefined)
  assert.equal(h.output(2).shown, true)
})

test('closing output windows during app shutdown does not send to the closed controller', () => {
  const h = setup()
  h.update({ visible: true })
  const win = h.output(1)
  h.windows[0].emit('closed')
  const count = h.windows[0].webContents.messages.length
  win.destroy()
  assert.equal(h.windows[0].webContents.messages.length, count)
})
