/** Supported document formats (SDS §3.5 / MVP). */
export enum DocumentFormat {
  Epub = 'epub',
  Pdf = 'pdf',
  Txt = 'txt',
  Md = 'md',
  Docx = 'docx',
}

const ALL_FORMATS: readonly DocumentFormat[] = [
  DocumentFormat.Epub,
  DocumentFormat.Pdf,
  DocumentFormat.Txt,
  DocumentFormat.Md,
  DocumentFormat.Docx,
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
