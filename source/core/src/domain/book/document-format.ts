/** Supported document formats (SDS §3.5 / MVP). */
export enum DocumentFormat {
  Epub = 'epub',
  Pdf = 'pdf',
  Txt = 'txt',
  Md = 'md',
  /** Audiobook: one MP3 file, played through `<audio>` (see src/audio/). */
  Mp3 = 'mp3',
  /** Audiobooks in other containers/codecs (see src/audio/audio-formats.ts for their playback status). */
  M4a = 'm4a',
  M4b = 'm4b',
  Aac = 'aac',
  Wav = 'wav',
  Flac = 'flac',
  Ogg = 'ogg',
  Opus = 'opus',
}

const ALL_FORMATS: readonly DocumentFormat[] = [
  DocumentFormat.Epub,
  DocumentFormat.Pdf,
  DocumentFormat.Txt,
  DocumentFormat.Md,
  DocumentFormat.Mp3,
  DocumentFormat.M4a,
  DocumentFormat.M4b,
  DocumentFormat.Aac,
  DocumentFormat.Wav,
  DocumentFormat.Flac,
  DocumentFormat.Ogg,
  DocumentFormat.Opus,
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
