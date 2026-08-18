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
  getGoogleOAuthConfig: () =>
    ipcRenderer.invoke(AppChannels.getGoogleOAuthConfig),
  setChromeTheme: (theme) =>
    ipcRenderer.invoke(AppChannels.setChromeTheme, theme),
  getFullscreen: () => ipcRenderer.invoke(AppChannels.getFullscreen),
  setFullscreen: (value) =>
    ipcRenderer.invoke(AppChannels.setFullscreen, value),
  toggleFullscreen: () => ipcRenderer.invoke(AppChannels.toggleFullscreen),
  onFullscreenChanged: (handler) => {
    const listener = (_event: Electron.IpcRendererEvent, fullscreen: boolean) => {
      handler(Boolean(fullscreen))
    }
    ipcRenderer.on(AppChannels.fullscreenChanged, listener)
    return () => {
      ipcRenderer.removeListener(AppChannels.fullscreenChanged, listener)
    }
  },
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
    markAsCompleted: (id) =>
      ipcRenderer.invoke(LibraryChannels.markAsCompleted, id),
    setFavorite: (id, value) =>
      ipcRenderer.invoke(LibraryChannels.setFavorite, id, value),
    updateMetadata: (input) =>
      ipcRenderer.invoke(LibraryChannels.updateMetadata, input),
    showInFolder: (id) => ipcRenderer.invoke(LibraryChannels.showInFolder, id),
    copyFilePath: (id) => ipcRenderer.invoke(LibraryChannels.copyFilePath, id),
    removeBook: (id) => ipcRenderer.invoke(LibraryChannels.removeBook, id),
    deleteBookFile: (id) =>
      ipcRenderer.invoke(LibraryChannels.deleteBookFile, id),
    listCollections: () => ipcRenderer.invoke(LibraryChannels.listCollections),
    createCollection: (input) =>
      ipcRenderer.invoke(LibraryChannels.createCollection, input),
    updateCollection: (id, input) =>
      ipcRenderer.invoke(LibraryChannels.updateCollection, id, input),
    deleteCollection: (id) =>
      ipcRenderer.invoke(LibraryChannels.deleteCollection, id),
    addBookToCollection: (collectionId, bookId) =>
      ipcRenderer.invoke(
        LibraryChannels.addBookToCollection,
        collectionId,
        bookId,
      ),
    removeBookFromCollection: (collectionId, bookId) =>
      ipcRenderer.invoke(
        LibraryChannels.removeBookFromCollection,
        collectionId,
        bookId,
      ),
  },
  import: {
    fromFile: () => ipcRenderer.invoke(ImportChannels.fromFile),
    fromUrl: (url) => ipcRenderer.invoke(ImportChannels.fromUrl, url),
  },
  overlay: {
    listAnnotations: (input) =>
      ipcRenderer.invoke(OverlayChannels.listAnnotations, input),
    saveAnnotation: (input) =>
      ipcRenderer.invoke(OverlayChannels.saveAnnotation, input),
    updateAnnotation: (input) =>
      ipcRenderer.invoke(OverlayChannels.updateAnnotation, input),
    deleteAnnotation: (input) =>
      ipcRenderer.invoke(OverlayChannels.deleteAnnotation, input),
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
