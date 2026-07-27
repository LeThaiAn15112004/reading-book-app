import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from './ipc/api-types'
import {
  AppChannels,
  ImportChannels,
  LibraryChannels,
  OverlayChannels,
} from './ipc/channels'

const api: DesktopApi = {
  ping: () => ipcRenderer.invoke(AppChannels.ping),
  getAppInfo: () => ipcRenderer.invoke(AppChannels.getAppInfo),
  setChromeTheme: (theme) =>
    ipcRenderer.invoke(AppChannels.setChromeTheme, theme),
  library: {
    listBooks: () => ipcRenderer.invoke(LibraryChannels.listBooks),
    getBook: (id) => ipcRenderer.invoke(LibraryChannels.getBook, id),
    openBookContent: (id) => ipcRenderer.invoke(LibraryChannels.openBookContent, id),
    markAsReading: (id) => ipcRenderer.invoke(LibraryChannels.markAsReading, id),
    deleteBook: (id) => ipcRenderer.invoke(LibraryChannels.deleteBook, id),
  },
  import: {
    fromFile: () => ipcRenderer.invoke(ImportChannels.fromFile),
    fromUrl: (url) => ipcRenderer.invoke(ImportChannels.fromUrl, url),
  },
  overlay: {
    list: (bookId) => ipcRenderer.invoke(OverlayChannels.list, bookId),
    addHighlight: (input) => ipcRenderer.invoke(OverlayChannels.addHighlight, input),
    addNote: (input) => ipcRenderer.invoke(OverlayChannels.addNote, input),
    listBookmarks: (bookId) => ipcRenderer.invoke(OverlayChannels.listBookmarks, bookId),
  },
}

contextBridge.exposeInMainWorld('api', api)
