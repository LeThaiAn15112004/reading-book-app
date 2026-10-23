/** Supported document formats (SDS §3.5 / MVP). */
export enum DocumentFormat {
  Epub = 'epub',
  Pdf = 'pdf',
  Txt = 'txt',
  Md = 'md',
  /** Audiobook: one MP3 file, played through `<audio>` (see src/audio/). */
  Mp3 = 'mp3',
}

const ALL_FORMATS: readonly DocumentFormat[] = [
  DocumentFormat.Epub,
  DocumentFormat.Pdf,
  DocumentFormat.Txt,
  DocumentFormat.Md,
  DocumentFormat.Mp3,
];

export function isDocumentFormat(value: string): value is DocumentFormat {
  return (ALL_FORMATS as readonly string[]).includes(value);
}

export function parseDocumentFormat(value: string): DocumentFormat {
  if (!isDocumentFormat(value)) {
    throw new Error(`Unsupported document format: ${value}`);
  }
  return value;
}
