import { describe, expect, it } from 'vitest';
import { levelFor, periodStart, progress, rank } from './levels';
import { attachmentDisposition, detectFileType, formatSize, safeFilename } from './files';

describe('levels', () => {
  it('maps points to levels', () => {
    expect(levelFor(0)).toBe(1);
    expect(levelFor(4)).toBe(1);
    expect(levelFor(5)).toBe(2);
    expect(levelFor(64)).toBe(3);
    expect(levelFor(65)).toBe(4);
    expect(levelFor(1_000_000)).toBe(9);
  });
  it('reports progress to the next level', () => {
    expect(progress(10)).toEqual({ level: 2, points: 10, nextLevelAt: 20, toNext: 10, percent: 33 });
    expect(progress(40000)).toMatchObject({ level: 9, nextLevelAt: null, percent: 100 });
  });
  it('ranks ties together', () => {
    expect(rank([{ points: 9 }, { points: 5 }, { points: 5 }, { points: 1 }]).map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });
  it('periods', () => {
    const now = new Date('2026-11-21T00:00:00Z');
    expect(periodStart('all', now)).toBeNull();
    expect(periodStart('7d', now)!.toISOString()).toBe('2026-11-14T00:00:00.000Z');
  });
});

describe('file attachments', () => {
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  it('detects by content, using the name only inside the zip family', () => {
    expect(detectFileType(Buffer.from('%PDF-1.7\n...'), 'whatever.txt')).toBe('application/pdf');
    expect(detectFileType(zip, 'Plan.DOCX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(detectFileType(zip, 'data.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(detectFileType(zip, 'bundle.zip')).toBe('application/zip');
    expect(detectFileType(zip, 'evil.jar')).toBeNull();
    expect(detectFileType(Buffer.from('name,email\nAna,a@x.io\n'), 'list.csv')).toBe('text/csv');
    expect(detectFileType(Buffer.from('# Notes'), 'notes.md')).toBe('text/markdown');
  });
  it('refuses executables, HTML/SVG disguised as text, binaries and old Office files', () => {
    expect(detectFileType(Buffer.from('MZ\x90\x00'), 'setup.exe')).toBeNull();
    expect(detectFileType(Buffer.from('<!DOCTYPE html><script>alert(1)</script>'), 'page.txt')).toBeNull();
    expect(detectFileType(Buffer.from('<svg onload=alert(1)>'), 'x.txt')).toBeNull();
    expect(detectFileType(Buffer.from([0x41, 0x00, 0x42]), 'bin.txt')).toBeNull();
    expect(detectFileType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), 'old.doc')).toBeNull();
    expect(detectFileType(Buffer.from([0xff, 0xfe, 0xfd]), 'bad.txt')).toBeNull();
  });
  it('cleans names and forces the real extension', () => {
    expect(safeFilename('../../etc/passwd', 'text/plain')).toBe('passwd.txt');
    expect(safeFilename('C:\\Users\\me\\Q3 "report".pdf', 'application/pdf')).toBe('Q3 report.pdf');
    expect(safeFilename('invoice.pdf.exe', 'application/pdf')).toBe('invoice.pdf.pdf');
    expect(safeFilename('', 'application/zip')).toBe('file.zip');
    expect(safeFilename('Q3 %22plan%22.PDF', 'application/pdf')).toBe('Q3 plan.pdf');
    expect(safeFilename('a%0Ab.txt', 'text/plain')).toBe('a b.txt');
  });
  it('always downloads, with a UTF-8 name', () => {
    expect(attachmentDisposition('Résumé.pdf')).toBe(`attachment; filename="R_sum_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9.pdf`);
  });
  it('formats sizes', () => {
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(1536)).toBe('1.5 KB');
    expect(formatSize(3 * 1024 * 1024)).toBe('3 MB');
  });
});
