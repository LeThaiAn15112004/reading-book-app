/** Fixed IPC channel names — preload may only invoke these. */

export const AppChannels = {
  ping: 'app:ping',
  getAppInfo: 'app:getAppInfo',
} as const

export const LibraryChannels = {
  listBooks: 'library:listBooks',
  getBook: 'library:getBook',
  deleteBook: 'library:deleteBook',
} as const

export const ImportChannels = {
  fromFile: 'import:fromFile',
  fromUrl: 'import:fromUrl',
} as const

export const OverlayChannels = {
  list: 'overlay:list',
  addHighlight: 'overlay:addHighlight',
  addNote: 'overlay:addNote',
  listBookmarks: 'overlay:listBookmarks',
} as const
