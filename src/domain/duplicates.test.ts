import { describe, expect, it } from 'vitest';
import { checkDuplicate, type KnownAlbum } from './duplicates';

const known = (over: Partial<KnownAlbum>): KnownAlbum => ({
  albumId: 'album-1',
  mbid: 'mb-dsotm',
  artist: 'Pink Floyd',
  title: 'The Dark Side of the Moon',
  activeCopies: 1,
  removedCopies: 0,
  ...over,
});

describe('checkDuplicate', () => {
  it('says new when nothing matches', () => {
    const result = checkDuplicate({ mbid: 'mb-rumours', artist: 'Fleetwood Mac', title: 'Rumours' }, [known({})]);
    expect(result.kind).toBe('new');
  });

  it('catches an owned album by MusicBrainz ID', () => {
    const result = checkDuplicate({ mbid: 'mb-dsotm', artist: 'Pink Floyd', title: 'Dark Side' }, [known({})]);
    expect(result.kind).toBe('owned');
  });

  it('catches "Dark Side of the Moon" against "The Dark Side of the Moon" with no shared ID', () => {
    const result = checkDuplicate({ mbid: null, artist: 'Pink Floyd', title: 'Dark Side of the Moon' }, [known({})]);
    expect(result.kind).toBe('owned');
  });

  it('asks instead of assuming when the name matches but MusicBrainz says it is a different album', () => {
    const blue = known({ albumId: 'blue', mbid: 'mb-weezer-blue', artist: 'Weezer', title: 'Weezer' });
    const result = checkDuplicate({ mbid: 'mb-weezer-green', artist: 'Weezer', title: 'Weezer' }, [blue]);
    expect(result).toMatchObject({ kind: 'possible', album: { albumId: 'blue' } });
  });

  it('catches a manual entry of an album already owned from search', () => {
    const result = checkDuplicate({ mbid: null, artist: 'pink floyd', title: 'DARK SIDE OF THE MOON' }, [known({})]);
    expect(result.kind).toBe('owned');
  });

  it('reports previously owned when every copy was removed', () => {
    const result = checkDuplicate({ mbid: 'mb-dsotm', artist: 'Pink Floyd', title: 'The Dark Side of the Moon' }, [
      known({ activeCopies: 0, removedCopies: 1 }),
    ]);
    expect(result.kind).toBe('previously_owned');
  });

  it('prefers a currently owned match over a previously owned one', () => {
    const result = checkDuplicate({ mbid: null, artist: 'Pink Floyd', title: 'Dark Side of the Moon' }, [
      known({ albumId: 'old', mbid: null, activeCopies: 0, removedCopies: 2 }),
      known({ albumId: 'current', activeCopies: 2 }),
    ]);
    expect(result).toMatchObject({ kind: 'owned', album: { albumId: 'current', activeCopies: 2 } });
  });

  it('treats an album known only through ratings (borrowed, never owned) as new to the collection', () => {
    const result = checkDuplicate({ mbid: 'mb-dsotm', artist: 'Pink Floyd', title: 'The Dark Side of the Moon' }, [
      known({ activeCopies: 0, removedCopies: 0 }),
    ]);
    expect(result.kind).toBe('new');
  });
});
