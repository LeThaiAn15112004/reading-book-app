/**
 * `HostFs` on `expo-file-system` and `expo-document-picker` (spec 008, T052; Expo 57 docs, `sdk/filesystem`,
 * `sdk/document-picker`). App-private storage is `Paths.document`, which the system does not clear; only relative
 * paths are stored, because iOS can move the container after an update.
 *
 * The picked file:
 *   - iOS: the picker copies it to the cache (`copyToCacheDirectory`), and the service reads that `file://` copy.
 *   - Android: the service reads the picker's own `content://` document URI (ACTION_OPEN_DOCUMENT, so a SAF document
 *     that `File.open('r')` supports), once, right after the pick. Not a cache copy, because in Expo Go the picker
 *     writes that copy outside the project's scoped folders and `expo-file-system` then refuses to open it
 *     (`InvalidPermissionException`, shown to the user as "Could not read the selected file", 2026-11-05). The
 *     document is only ever read: `discardUri` never deletes a `content://` URI, which is the user's own file.
 */
import * as DocumentPicker from 'expo-document-picker'
import { Directory, File, FileMode, Paths } from 'expo-file-system'
import { Platform } from 'react-native'

import type { ByteReader, ByteWriter, HostFs, PickedDocument } from './file-service'

/** Android reads the picked document in place (see above); iOS reads a cache copy. */
const COPY_PICKED_TO_CACHE = Platform.OS !== 'android'

const isContentUri = (uri: string) => uri.startsWith('content:')

const segments = (rel: string) => rel.split('/').filter(Boolean)
const appFile = (rel: string) => new File(Paths.document, ...segments(rel))
const appDir = (rel: string) => new Directory(Paths.document, ...segments(rel))

function info(rel: string) {
  return Paths.info(appFile(rel).uri)
}

function reader(file: File): ByteReader {
  const handle = file.open(FileMode.ReadOnly)
  return {
    read: (length) => handle.readBytes(length),
    close: () => handle.close(),
  }
}

export function createExpoHostFs(): HostFs {
  return {
    async pickDocument(): Promise<PickedDocument | null> {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: COPY_PICKED_TO_CACHE, multiple: false })
      if (result.canceled || !result.assets?.length) return null
      const asset = result.assets[0]!
      const size = asset.size ?? new File(asset.uri).size
      return { uri: asset.uri, name: asset.name, size }
    },

    availableBytes: () => Paths.availableDiskSpace,

    exists: (rel) => info(rel).exists,

    fileSize(rel) {
      const found = info(rel)
      if (!found.exists || found.isDirectory) return undefined
      return appFile(rel).size
    },

    list(rel) {
      const found = info(rel)
      if (!found.exists || !found.isDirectory) return []
      return appDir(rel).list().map((entry) => entry.name)
    },

    mkdirp(rel) {
      appDir(rel).create({ intermediates: true, idempotent: true })
    },

    remove(rel) {
      const found = info(rel)
      if (!found.exists) return
      if (found.isDirectory) appDir(rel).delete()
      else appFile(rel).delete()
    },

    async move(fromRel, toRel) {
      await appFile(fromRel).move(appFile(toRel))
    },

    openRead: (rel) => reader(appFile(rel)),

    openReadUri: (uri) => reader(new File(uri)),

    openWrite(rel): ByteWriter {
      const file = appFile(rel)
      file.create({ overwrite: true })
      const handle = file.open(FileMode.Truncate)
      return {
        write: (bytes) => handle.writeBytes(bytes),
        close: () => handle.close(),
      }
    },

    writeFile(rel, bytes) {
      const file = appFile(rel)
      file.create({ overwrite: true })
      file.write(bytes)
    },

    readRange(rel, offset, length) {
      const handle = appFile(rel).open(FileMode.ReadOnly)
      try {
        handle.offset = offset
        return handle.readBytes(length)
      } finally {
        handle.close()
      }
    },

    discardUri(uri) {
      // A content:// URI is the user's own document, never a copy of ours: nothing to discard.
      if (isContentUri(uri)) return
      try {
        const file = new File(uri)
        if (file.exists) file.delete()
      } catch {
        // A cache copy the system already cleared.
      }
    },
  }
}
