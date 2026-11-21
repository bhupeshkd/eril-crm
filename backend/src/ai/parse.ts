/** Splits "Subject: ...\n\nbody" into parts. */
export function parseEmailDraft(text: string) {
  const m = text.match(/^\s*subject\s*:\s*(.+)\r?\n+([\s\S]*)$/i);
  return m ? { subject: m[1].trim(), body: m[2].trim() } : { subject: '', body: text.trim() };
}
