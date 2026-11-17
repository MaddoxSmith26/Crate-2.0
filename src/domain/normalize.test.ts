import { describe, expect, it } from 'vitest';
import { albumKey, isSameAlbum, normalizeArtist, normalizeTitle, slugify } from './normalize';

describe('normalizeTitle', () => {
  it('treats "The Dark Side of the Moon" and "Dark Side of the Moon" as the same', () => {
    expect(normalizeTitle('The Dark Side of the Moon')).toBe(normalizeTitle('Dark Side of the Moon'));
  });

  it('only drops a leading article', () => {
    expect(normalizeTitle('Dark Side of the Moon')).toBe('dark side of the moon');
    expect(normalizeTitle('A Night at the Opera')).toBe('night at the opera');
  });

  it('keeps a title that is only an article', () => {
    expect(normalizeTitle('The')).toBe('the');
  });

  it('ignores case, punctuation, accents and extra spaces', () => {
    expect(normalizeTitle("  Sgt. Pepper's   Lonely Hearts Club Band ")).toBe('sgt peppers lonely hearts club band');
    expect(normalizeTitle('Déjà Vu')).toBe('deja vu');
    expect(normalizeTitle('Homogenic!')).toBe('homogenic');
  });

  it('treats & and "and" alike', () => {
    expect(normalizeTitle('Bridge & Tunnel')).toBe(normalizeTitle('Bridge and Tunnel'));
  });

  it('treats curly and straight apostrophes alike', () => {
    expect(normalizeTitle('What’s Going On')).toBe(normalizeTitle("What's Going On"));
  });
});

describe('normalizeArtist', () => {
  it('matches with or without "The"', () => {
    expect(normalizeArtist('The Beatles')).toBe(normalizeArtist('Beatles'));
  });

  it('keeps the band The The distinguishable from nothing', () => {
    expect(normalizeArtist('The The')).toBe('the');
  });

  it('strips accents', () => {
    expect(normalizeArtist('Beyoncé')).toBe('beyonce');
    expect(normalizeArtist('Sigur Rós')).toBe('sigur ros');
  });
});

describe('albumKey and isSameAlbum', () => {
  it('catches the Dark Side duplicate from the brief', () => {
    expect(
      isSameAlbum(
        { artist: 'Pink Floyd', title: 'The Dark Side of the Moon' },
        { artist: 'Pink Floyd', title: 'Dark Side of the Moon' },
      ),
    ).toBe(true);
  });

  it('matches AC/DC, AC-DC and ACDC', () => {
    expect(albumKey('AC/DC', 'Back in Black')).toBe(albumKey('ACDC', 'Back In Black'));
    expect(albumKey('AC-DC', 'Back in Black')).toBe(albumKey('ACDC', 'Back In Black'));
  });

  it('keeps different albums apart', () => {
    expect(isSameAlbum({ artist: 'Pink Floyd', title: 'The Wall' }, { artist: 'Pink Floyd', title: 'Animals' })).toBe(false);
  });

  it('keeps the same title by different artists apart', () => {
    expect(isSameAlbum({ artist: 'Weezer', title: 'Weezer' }, { artist: 'Peter Gabriel', title: 'Weezer' })).toBe(false);
  });

  it('keeps numbered sequels apart', () => {
    expect(isSameAlbum({ artist: 'Led Zeppelin', title: 'Led Zeppelin II' }, { artist: 'Led Zeppelin', title: 'Led Zeppelin III' })).toBe(false);
  });
});

describe('slugify', () => {
  it('builds a URL-safe slug', () => {
    expect(slugify('Fleetwood Mac', 'Rumours')).toBe('fleetwood-mac-rumours');
    expect(slugify('AC/DC', "Let There Be Rock!")).toBe('ac-dc-let-there-be-rock');
    expect(slugify('', 'Björk')).toBe('bjork');
  });
});
