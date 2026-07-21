import { DocumentFormat } from '@reading-book/domain';

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
  {
    format: DocumentFormat.Docx,
    extensions: ['.docx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    displayName: 'Word Document',
  },
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
