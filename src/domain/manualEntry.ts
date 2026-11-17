/**
 * Manual album entry: turns the tracklist a person types (one track per
 * line) into tracks. A length at the end of a line is optional:
 *   "Dreams"            "Dreams 4:14"            "3. Dreams - 4:14"
 */
export interface ManualTrack {
  position: number;
  title: string;
  lengthMs: number | null;
}

const LENGTH_AT_END = /^(.*?)[\s\-–—(]*\b(\d{1,3}):([0-5]\d)\)?\s*$/;
const LEADING_NUMBER = /^\s*[A-Da-d]?\d{1,3}\s*[.)\-:]\s+/;

export function parseManualTracks(text: string): ManualTrack[] {
  const tracks: ManualTrack[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line) continue;
    let lengthMs: number | null = null;
    const match = LENGTH_AT_END.exec(line);
    if (match && match[1] && match[1].trim().length > 0) {
      lengthMs = (Number(match[2]) * 60 + Number(match[3])) * 1000;
      line = match[1].trim();
    }
    // Drop a typed track number ("1. ", "A2) ", "03 - "). A number followed by
    // only a space is kept, because it is usually part of the title ("7 Rings").
    const withoutNumber = line.replace(LEADING_NUMBER, '').trim();
    const title = (withoutNumber.length > 0 ? withoutNumber : line).replace(/[\s\-–—]+$/, '').trim();
    if (!title) continue;
    tracks.push({ position: tracks.length + 1, title, lengthMs: lengthMs && lengthMs > 0 ? lengthMs : null });
  }
  return tracks;
}

/** Checks the typed year. Empty is fine. */
export function parseYearInput(text: string): { year: number | null; valid: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { year: null, valid: true };
  if (!/^\d{4}$/.test(trimmed)) return { year: null, valid: false };
  const year = Number(trimmed);
  return year >= 1860 && year <= new Date().getFullYear() + 1 ? { year, valid: true } : { year: null, valid: false };
}

/** Checks a typed date like 2026-11-16. Rejects impossible and future dates. */
export function parseDateInput(text: string, now: Date = new Date()): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 12, 0, 0); // noon local: safe from timezone edges
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  return date <= endOfToday ? date : null;
}

/** Today as YYYY-MM-DD in local time. */
export function todayInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
