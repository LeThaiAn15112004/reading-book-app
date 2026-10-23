import { DocumentFormat } from '@reading-book/book-reader-sdk';

export interface FormatDescriptor {
  format: DocumentFormat;
  extensions: readonly string[];
  mimeTypes: readonly string[];
  displayName: string;
}

export const SUPPORTED_FORMATS: readonly FormatDescriptor[] = [
  {
    format: DocumentFormat.Epub,
    extensions: ['.epub'],
    mimeTypes: ['application/epub+zip'],
    displayName: 'EPUB',
  },
  {
    format: DocumentFormat.Pdf,
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    displayName: 'PDF',
  },
  {
    format: DocumentFormat.Txt,
    extensions: ['.txt'],
    mimeTypes: ['text/plain'],
    displayName: 'Plain Text',
  },
  {
    format: DocumentFormat.Md,
    extensions: ['.md'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    displayName: 'Markdown',
  },
  // Audiobooks. Per-format playback status lives in the SDK (`audioPlaybackStatus`); every format here was
  // played with a real encoder-made file (docs/implementation_plan/audiobook_implementation_plan.md).
  { format: DocumentFormat.Mp3, extensions: ['.mp3'], mimeTypes: ['audio/mpeg'], displayName: 'MP3 Audio' },
  { format: DocumentFormat.M4a, extensions: ['.m4a'], mimeTypes: ['audio/mp4'], displayName: 'M4A Audio' },
  { format: DocumentFormat.M4b, extensions: ['.m4b'], mimeTypes: ['audio/mp4'], displayName: 'M4B Audiobook' },
  { format: DocumentFormat.Aac, extensions: ['.aac'], mimeTypes: ['audio/aac'], displayName: 'AAC Audio' },
  { format: DocumentFormat.Wav, extensions: ['.wav'], mimeTypes: ['audio/wav'], displayName: 'WAV Audio' },
  { format: DocumentFormat.Flac, extensions: ['.flac'], mimeTypes: ['audio/flac'], displayName: 'FLAC Audio' },
  { format: DocumentFormat.Ogg, extensions: ['.ogg'], mimeTypes: ['audio/ogg'], displayName: 'Ogg Audio' },
  { format: DocumentFormat.Opus, extensions: ['.opus'], mimeTypes: ['audio/ogg'], displayName: 'Opus Audio' },
] as const;

export const SUPPORTED_EXTENSIONS: readonly string[] = SUPPORTED_FORMATS.flatMap(
  (descriptor) => descriptor.extensions,
);

function normalizeExtension(ext: string): string {
  const trimmed = ext.trim().toLowerCase();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`;
}

export function resolveFormatFromExtension(ext: string): DocumentFormat | undefined {
  const normalized = normalizeExtension(ext);
  const match = SUPPORTED_FORMATS.find((descriptor) =>
    descriptor.extensions.includes(normalized),
  );
  return match?.format;
}

export function isSupportedExtension(ext: string): boolean {
  return resolveFormatFromExtension(ext) !== undefined;
}
