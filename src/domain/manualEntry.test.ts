import { describe, expect, it } from 'vitest';
import { parseDateInput, parseManualTracks, parseYearInput, todayInput } from './manualEntry';

describe('parseManualTracks', () => {
  it('reads one track per line and skips blank lines', () => {
    expect(parseManualTracks('Second Hand News\n\n  Dreams  \nNever Going Back Again')).toEqual([
      { position: 1, title: 'Second Hand News', lengthMs: null },
      { position: 2, title: 'Dreams', lengthMs: null },
      { position: 3, title: 'Never Going Back Again', lengthMs: null },
    ]);
  });

  it('reads an optional length at the end of a line', () => {
    const tracks = parseManualTracks('Dreams 4:14\nThe Chain - 4:30\nSongbird (3:20)\nGold Dust Woman – 4:56');
    expect(tracks.map((t) => [t.title, t.lengthMs])).toEqual([
      ['Dreams', 254000],
      ['The Chain', 270000],
      ['Songbird', 200000],
      ['Gold Dust Woman', 296000],
    ]);
  });

  it('drops typed track numbers but keeps titles that are numbers', () => {
    const tracks = parseManualTracks('1. Dreams\n02 - The Chain 4:30\nA1) Songbird\n1999\n7 Rings\n25 or 6 to 4 4:50');
    expect(tracks.map((t) => t.title)).toEqual(['Dreams', 'The Chain', 'Songbird', '1999', '7 Rings', '25 or 6 to 4']);
  });

  it('does not treat a title that is only a time as a length', () => {
    expect(parseManualTracks('4:33')).toEqual([{ position: 1, title: '4:33', lengthMs: null }]);
  });
});

describe('parseYearInput', () => {
  it('accepts empty and real years, rejects the rest', () => {
    expect(parseYearInput('')).toEqual({ year: null, valid: true });
    expect(parseYearInput(' 1977 ')).toEqual({ year: 1977, valid: true });
    expect(parseYearInput('77').valid).toBe(false);
    expect(parseYearInput('1500').valid).toBe(false);
    expect(parseYearInput('3000').valid).toBe(false);
  });
});

describe('parseDateInput', () => {
  const now = new Date(2026, 10, 16, 22, 0, 0);
  it('accepts today and past dates', () => {
    expect(parseDateInput('2026-11-16', now)?.getDate()).toBe(16);
    expect(parseDateInput('2020-02-29', now)?.getMonth()).toBe(1);
    expect(todayInput(now)).toBe('2026-11-16');
  });
  it('rejects future, impossible and badly typed dates', () => {
    expect(parseDateInput('2026-11-17', now)).toBeNull();
    expect(parseDateInput('2026-02-30', now)).toBeNull();
    expect(parseDateInput('11/16/2026', now)).toBeNull();
    expect(parseDateInput('', now)).toBeNull();
  });
});
