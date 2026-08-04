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
  onRequestFlushSession: (handler) => {
    const listener = (): void => {
      void Promise.resolve()
        .then(() => handler())
        .catch(() => {})
        .finally(() => {
          ipcRenderer.send(AppChannels.flushSessionDone)
        })
    }
    ipcRenderer.on(AppChannels.requestFlushSession, listener)
    return () => {
      ipcRenderer.removeListener(AppChannels.requestFlushSession, listener)
    }
  },
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
    updateHighlightNote: (input) =>
      ipcRenderer.invoke(OverlayChannels.updateHighlightNote, input),
    deleteHighlight: (input) =>
      ipcRenderer.invoke(OverlayChannels.deleteHighlight, input),
    listBookmarks: (bookId) => ipcRenderer.invoke(OverlayChannels.listBookmarks, bookId),
    saveBookmark: (input) => ipcRenderer.invoke(OverlayChannels.saveBookmark, input),
    deleteBookmark: (input) =>
      ipcRenderer.invoke(OverlayChannels.deleteBookmark, input),
    getSessionState: (bookId) =>
      ipcRenderer.invoke(OverlayChannels.getSessionState, bookId),
    saveSessionState: (input) =>
      ipcRenderer.invoke(OverlayChannels.saveSessionState, input),
  },
}

contextBridge.exposeInMainWorld('api', api)
