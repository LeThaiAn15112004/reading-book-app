import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from './ipc/api-types'
import {
  AppChannels,
  BookIndexChannels,
  CloudChannels,
  ImportChannels,
  LibraryChannels,
  OverlayChannels,
  SearchChannels,
  TranslationChannels,
  WordCountChannels,
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
  captureSnapshot: (region) => ipcRenderer.invoke(AppChannels.captureSnapshot, region),
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
    relinkBook: (id) => ipcRenderer.invoke(LibraryChannels.relinkBook, id),
    checkSignature: (id) => ipcRenderer.invoke(LibraryChannels.checkSignature, id),
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
    cancel: () => ipcRenderer.invoke(ImportChannels.cancel),
    onProgress: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: Parameters<typeof handler>[0],
      ) => {
        handler(progress)
      }
      ipcRenderer.on(ImportChannels.progress, listener)
      return () => {
        ipcRenderer.removeListener(ImportChannels.progress, listener)
      }
    },
  },
  overlay: {
    getSessionState: (bookId) =>
      ipcRenderer.invoke(OverlayChannels.getSessionState, bookId),
    saveSessionState: (input) =>
      ipcRenderer.invoke(OverlayChannels.saveSessionState, input),
    listBookmarks: (bookId) =>
      ipcRenderer.invoke(OverlayChannels.listBookmarks, bookId),
    saveBookmark: (input) =>
      ipcRenderer.invoke(OverlayChannels.saveBookmark, input),
    deleteBookmark: (input) =>
      ipcRenderer.invoke(OverlayChannels.deleteBookmark, input),
    listHighlights: (bookId) =>
      ipcRenderer.invoke(OverlayChannels.listHighlights, bookId),
    saveHighlight: (input) =>
      ipcRenderer.invoke(OverlayChannels.saveHighlight, input),
    deleteHighlight: (input) =>
      ipcRenderer.invoke(OverlayChannels.deleteHighlight, input),
  },
  bookIndex: {
    ensure: (bookId) => ipcRenderer.invoke(BookIndexChannels.ensure, bookId),
    onStatus: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: Parameters<typeof handler>[0],
      ) => {
        handler(status)
      }
      ipcRenderer.on(BookIndexChannels.status, listener)
      return () => {
        ipcRenderer.removeListener(BookIndexChannels.status, listener)
      }
    },
  },
  search: {
    searchBook: (request) => ipcRenderer.invoke(SearchChannels.searchBook, request),
  },
  wordCount: {
    getStats: (bookId) => ipcRenderer.invoke(WordCountChannels.getStats, bookId),
  },
  translation: {
    translate: (request) => ipcRenderer.invoke(TranslationChannels.translate, request),
    cancel: (requestId) => ipcRenderer.invoke(TranslationChannels.cancel, requestId),
    onProgress: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: Parameters<typeof handler>[0],
      ) => {
        handler(progress)
      }
      ipcRenderer.on(TranslationChannels.progress, listener)
      return () => {
        ipcRenderer.removeListener(TranslationChannels.progress, listener)
      }
    },
  },
  cloud: {
    connect: (provider) => ipcRenderer.invoke(CloudChannels.connect, provider),
    disconnect: (provider) => ipcRenderer.invoke(CloudChannels.disconnect, provider),
    getAccessToken: (provider) =>
      ipcRenderer.invoke(CloudChannels.getAccessToken, provider),
    downloadAndImport: (provider, entry) =>
      ipcRenderer.invoke(CloudChannels.downloadAndImport, provider, entry),
    cancelDownload: (externalId) =>
      ipcRenderer.invoke(CloudChannels.cancelDownload, externalId),
    onDownloadProgress: (handler) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        progress: Parameters<typeof handler>[0],
      ) => {
        handler(progress)
      }
      ipcRenderer.on(CloudChannels.downloadProgress, listener)
      return () => {
        ipcRenderer.removeListener(CloudChannels.downloadProgress, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('api', api)
