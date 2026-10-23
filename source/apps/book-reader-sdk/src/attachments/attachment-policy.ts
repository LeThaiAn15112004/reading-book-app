/**
 * Embedded-file ("attachment") policy shared by Main and the renderer: the descriptor the Attachment
 * panel shows, id shape, name sanitising and the decision whether Readmate may hand an extracted file
 * to the operating system. Pure — no `fs` / `electron`; Main does the I/O around it.
 * See docs/implementation_plan/pdf_attachments.md.
 */

/** Largest attachment Readmate will extract (checked on the real extracted bytes, not on metadata). */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024

/** A PDF listing more embedded files than this is truncated (a pathological file must not flood the panel). */
export const ATTACHMENT_MAX_COUNT = 500

const ATTACHMENT_NAME_MAX_LENGTH = 120
const ATTACHMENT_EXTENSION_MAX_LENGTH = 20

/** Where in the PDF the file lives: the document's EmbeddedFiles tree, or a page's FileAttachment annotation. */
export type AttachmentSource = 'document' | 'page'

export type BookAttachment = {
  /** Stable for one file's content and position; see `buildAttachmentId`. Never a path. */
  id: string
  /** Sanitised basename (what the file would be called on disk). */
  name: string
  /** Bytes, when the PDF record carries content; null when it could not be read. */
  size: number | null
  description: string | null
  /** 1-based page of a page-level attachment; null for document-level ones. */
  page: number | null
  source: AttachmentSource
}

const ATTACHMENT_ID_PATTERN = /^(?:doc-\d{1,5}|page-\d{1,6}-\d{1,5})-[0-9a-f]{12}$/

/**
 * `doc-{ordinal}-{hash}` / `page-{page}-{ordinal}-{hash}`. `ordinal` is the position inside its group
 * (so two files with the same name differ), `contentHash` the first 12 hex chars of the content's
 * SHA-256 (so a changed file cannot answer to an id that was listed for the old one).
 */
export function buildAttachmentId(
  source: AttachmentSource,
  page: number | null,
  ordinal: number,
  contentHash: string,
): string {
  const hash = contentHash.slice(0, 12).toLowerCase()
  return source === 'page' ? `page-${page ?? 0}-${ordinal}-${hash}` : `doc-${ordinal}-${hash}`
}

export function isAttachmentId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && ATTACHMENT_ID_PATTERN.test(value)
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g
/** Zero-width and bidi-override characters used to make `gpj.exe` read as `exe.jpg`. */
const INVISIBLE_FORMAT_CHARS = /[­​-‏‪-‮⁠-⁩﻿]/g
const RESERVED_WINDOWS_NAMES = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/**
 * A name that is safe to join onto a directory: no separators or drive letters (basename only), no
 * control / invisible characters, nothing Windows rejects, no `.` / `..`, no reserved device names,
 * bounded length (extension kept). Never empty — `fallback` stands in for a missing or unusable name.
 */
export function sanitizeAttachmentFileName(raw: unknown, fallback = 'attachment'): string {
  let name = typeof raw === 'string' ? raw : ''
  name = name.replace(CONTROL_CHARS, '').replace(INVISIBLE_FORMAT_CHARS, '')
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
  name = name.replace(/[<>:"|?*]/g, '_')
  name = name.replace(/^[\s.]+/, '').replace(/[\s.]+$/, '')
  if (!name) return fallback
  const firstDot = name.indexOf('.')
  const stem = firstDot === -1 ? name : name.slice(0, firstDot)
  if (RESERVED_WINDOWS_NAMES.test(stem)) name = `_${name}`
  if (name.length > ATTACHMENT_NAME_MAX_LENGTH) {
    const lastDot = name.lastIndexOf('.')
    const ext = lastDot > 0 && name.length - lastDot <= ATTACHMENT_EXTENSION_MAX_LENGTH ? name.slice(lastDot) : ''
    name = name.slice(0, ATTACHMENT_NAME_MAX_LENGTH - ext.length).replace(/[\s.]+$/, '') + ext
  }
  return name || fallback
}

/** Lower-case extension of the final segment, without the dot; '' when there is none. */
export function attachmentExtension(name: string): string {
  const normalised = name.normalize('NFKC').toLowerCase().replace(/[\s.]+$/, '')
  const lastDot = normalised.lastIndexOf('.')
  return lastDot > 0 ? normalised.slice(lastDot + 1) : ''
}

/**
 * Types that run code, mount, redirect or script when the OS "opens" them. Conservative on purpose:
 * Office macro formats, browser-hosted content (HTML / SVG run with `file:` access) and installers
 * are in. Anything listed is Save As only.
 */
const PROHIBITED_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows executables, installers, libraries
  'exe', 'com', 'scr', 'pif', 'msi', 'msp', 'mst', 'dll', 'sys', 'drv', 'ocx', 'cpl', 'xll', 'wll',
  'appx', 'msix', 'appxbundle', 'msixbundle', 'appinstaller', 'application', 'appref-ms', 'gadget',
  'jar', 'vsto', 'diagcab', 'theme', 'themepack',
  // Scripts and shells
  'bat', 'cmd', 'ps1', 'ps1xml', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'mjs', 'cjs', 'wsf', 'wsh',
  'wsc', 'hta', 'sct', 'msc', 'reg', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'command', 'run', 'py', 'pyw',
  'pl', 'rb', 'php', 'scpt', 'scptd', 'workflow', 'action', 'terminal',
  // Shortcuts and redirects
  'lnk', 'url', 'inf', 'scf', 'shb', 'shs', 'library-ms', 'searchconnector-ms', 'settingcontent-ms', 'iqy', 'slk',
  // Browser-hosted active content
  'html', 'htm', 'xhtml', 'xht', 'mht', 'mhtml', 'svg', 'svgz', 'chm', 'hlp',
  // Macro-enabled Office
  'docm', 'dotm', 'xlsm', 'xltm', 'xlam', 'pptm', 'potm', 'ppam', 'ppsm', 'sldm',
  // Disk images and packages that mount or install
  'iso', 'img', 'vhd', 'vhdx', 'dmg', 'pkg', 'app', 'deb', 'rpm', 'apk', 'appimage', 'bin', 'elf',
])

export type AttachmentBlockReason = 'prohibited_type' | 'no_extension' | 'executable_content'

export type AttachmentVerdict = { open: true } | { open: false; reason: AttachmentBlockReason }

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

const BINARY_SIGNATURES: readonly (readonly number[])[] = [
  [0x4d, 0x5a], // MZ — PE / DOS executable, DLL, SCR
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], [0xfe, 0xed, 0xfa, 0xcf], [0xce, 0xfa, 0xed, 0xfe], [0xcf, 0xfa, 0xed, 0xfe], // Mach-O
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O fat / Java class
  [0x4c, 0x00, 0x00, 0x00, 0x01, 0x14, 0x02, 0x00], // Windows .lnk
  [0x23, 0x21], // #! script
]

const TEXT_SIGNATURES: readonly string[] = [
  '<?php', '<script', '<html', '<!doctype html', '<svg', '[internetshortcut]', 'windows registry editor', 'regedit4',
]

/** True when the first bytes are an executable / script header, whatever the file is called. */
export function looksLikeActiveContent(head: Uint8Array): boolean {
  if (BINARY_SIGNATURES.some((signature) => startsWith(head, signature))) return true
  // The SDK has no TextDecoder (`lib: ES2022`); the signatures are ASCII, so a byte-wise read is enough.
  const hasUtf8Bom = startsWith(head, [0xef, 0xbb, 0xbf])
  const text = String.fromCharCode(...head.subarray(hasUtf8Bom ? 3 : 0, 64)).trimStart().toLowerCase()
  return TEXT_SIGNATURES.some((signature) => text.startsWith(signature))
}

/**
 * May Readmate hand this file to the OS default application? Judged on the sanitised final extension
 * AND the actual bytes: a prohibited extension, no extension (the OS would guess or ask) and an
 * executable / script header all block. Embedded MIME claims are never used to allow anything.
 * Passing this check is not a claim that the file is safe — only that it is not an obvious launcher.
 */
export function classifyAttachment(name: string, head: Uint8Array): AttachmentVerdict {
  const extension = attachmentExtension(name)
  if (!extension) return { open: false, reason: 'no_extension' }
  if (PROHIBITED_EXTENSIONS.has(extension)) return { open: false, reason: 'prohibited_type' }
  if (looksLikeActiveContent(head)) return { open: false, reason: 'executable_content' }
  return { open: true }
}

export function describeAttachmentBlock(reason: AttachmentBlockReason): string {
  switch (reason) {
    case 'prohibited_type':
      return 'This type of file can run code or scripts, so Readmate will not open it directly.'
    case 'no_extension':
      return 'This file has no file extension, so Readmate cannot tell what opening it would do.'
    case 'executable_content':
      return 'The contents of this file look like a program or script, whatever it is named.'
  }
}

export type AttachmentSizeVerdict = { ok: true } | { ok: false; reason: 'empty' | 'too_large' }

/** Applied to the extracted byte count — a record's declared size is never trusted. */
export function checkAttachmentSize(bytes: number): AttachmentSizeVerdict {
  if (bytes <= 0) return { ok: false, reason: 'empty' }
  return bytes > ATTACHMENT_MAX_BYTES ? { ok: false, reason: 'too_large' } : { ok: true }
}
