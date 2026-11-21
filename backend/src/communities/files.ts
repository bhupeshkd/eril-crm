/** File attachments for community posts: type detection by content, safe names and download headers. Pure helpers. */

export const FILE_MAX_BYTES = 10 * 1024 * 1024;
export const FILES_PER_POST = 3;

export type FileMime =
  | 'application/pdf'
  | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  | 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  | 'application/zip'
  | 'text/plain'
  | 'text/csv'
  | 'text/markdown';

const ZIP_TYPES: Record<string, FileMime> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
};
const TEXT_TYPES: Record<string, FileMime> = { txt: 'text/plain', csv: 'text/csv', md: 'text/markdown' };
export const FILE_EXT: Record<FileMime, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/markdown': 'md',
};

const extOf = (name: string) => (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '').toLowerCase();

function isUtf8Text(b: Buffer) {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides the type from the bytes (the name only picks between formats that share a container, like .docx vs .zip).
 * Anything else — executables, HTML, SVG, old macro-capable Office files — is refused.
 */
export function detectFileType(b: Buffer, filename: string): FileMime | null {
  const ext = extOf(filename);
  if (b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return ZIP_TYPES[ext] ?? null;
  if (TEXT_TYPES[ext] && isUtf8Text(b) && !/^\s*<(!doctype|html|svg|script)/i.test(b.subarray(0, 512).toString('utf8'))) return TEXT_TYPES[ext];
  return null;
}

/** A display name without paths or control characters, ending in the real type's extension. */
export function safeFilename(name: string, mime: FileMime): string {
  // Browsers send ", CR and LF in multipart file names as %22, %0D and %0A.
  const decoded = name.replace(/%22/gi, '"').replace(/%0[ad]/gi, ' ');
  const base = (decoded.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const ext = FILE_EXT[mime];
  const stem = base.replace(/\.[a-z0-9]{1,5}$/i, '').slice(0, 100).trim() || 'file';
  return `${stem}.${ext}`;
}

/** Content-Disposition that always downloads (never renders), with a UTF-8 name and an ASCII fallback. */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / (1024 * 102.4)) / 10} MB`;
}
