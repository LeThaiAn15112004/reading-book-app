/** Recording stand-in for the parts of `electron` that background-mode / background-prefs use. */
import fs from 'node:fs'

export const stub = { userData: '', quitCalls: 0, trays: [], failTray: false, loginItem: null, loginCalls: [] }

export const app = {
  getPath: (name) => {
    if (name !== 'userData') throw new Error(`unexpected app.getPath(${name})`)
    return stub.userData
  },
  quit: () => {
    stub.quitCalls += 1
  },
  /** Windows semantics: an entry is matched by exe path + args. */
  setLoginItemSettings: (settings) => {
    stub.loginCalls.push(settings)
    stub.loginItem = settings.openAtLogin ? { path: settings.path, args: settings.args ?? [] } : null
  },
  getLoginItemSettings: (query = {}) => ({
    openAtLogin:
      stub.loginItem !== null &&
      (query.path === undefined || query.path === stub.loginItem.path) &&
      JSON.stringify(query.args ?? stub.loginItem.args) === JSON.stringify(stub.loginItem.args),
    wasOpenedAtLogin: false,
  }),
}

export const Menu = { buildFromTemplate: (template) => ({ items: template }) }

export const nativeImage = {
  createFromPath: (file) => ({
    file,
    template: false,
    setTemplateImage(value) {
      this.template = value
    },
    isEmpty: () => !fs.existsSync(file),
  }),
}

export class Tray {
  constructor(image) {
    if (stub.failTray) throw new Error('tray unavailable')
    this.image = image
    this.destroyed = false
    this.handlers = {}
    stub.trays.push(this)
  }
  setToolTip(text) {
    this.tooltip = text
  }
  setContextMenu(menu) {
    this.menu = menu
  }
  on(event, handler) {
    this.handlers[event] = handler
  }
  destroy() {
    this.destroyed = true
  }
}
