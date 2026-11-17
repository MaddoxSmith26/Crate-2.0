/**
 * Duplicate detection when adding a record.
 *
 * Rule from the brief: if I already own the album, Crate says so instead of
 * creating a duplicate, and only offers a second copy if I really have
 * another pressing. Matching is by MusicBrainz release group ID first, then
 * by normalized artist and title, so manual entries are caught too.
 */

import { albumKey } from './normalize';

export interface AlbumIdentity {
  /** MusicBrainz release group ID. Null for manually entered albums. */
  mbid: string | null;
  artist: string;
  title: string;
}

/** An album the person has in their records, with how many copies. */
export interface KnownAlbum extends AlbumIdentity {
  albumId: string;
  /** Copies currently in the collection (not removed). */
  activeCopies: number;
  /** Copies that were removed. Their ratings and listens are kept. */
  removedCopies: number;
}

export type DuplicateCheck =
  /** Not in the collection: add the album and a first copy. */
  | { kind: 'new' }
  /** Already owned: warn, and offer "add another pressing" only. */
  | { kind: 'owned'; album: KnownAlbum }
  /** Owned before and removed: adding a copy brings back the same album and its history. */
  | { kind: 'previously_owned'; album: KnownAlbum }
  /**
   * Same artist and title as an owned album, but a different MusicBrainz
   * album. Usually a self-titled sequel (Weezer has several albums called
   * "Weezer"). The UI asks instead of assuming.
   */
  | { kind: 'possible'; album: KnownAlbum };

type Match = 'exact' | 'same_name' | 'none';

function match(candidate: AlbumIdentity, known: AlbumIdentity): Match {
  if (candidate.mbid && known.mbid && candidate.mbid === known.mbid) return 'exact';
  if (albumKey(candidate.artist, candidate.title) !== albumKey(known.artist, known.title)) return 'none';
  // Same name. If both sides have MusicBrainz IDs and they differ, MusicBrainz
  // says these are different albums, so it is only a possible duplicate.
  return candidate.mbid && known.mbid ? 'same_name' : 'exact';
}

/**
 * Checks a candidate album against one person's known albums.
 * A currently owned match wins over a previously owned one.
 */
export function checkDuplicate(candidate: AlbumIdentity, known: readonly KnownAlbum[]): DuplicateCheck {
  const exact = known.filter((k) => match(candidate, k) === 'exact');
  const owned = exact.find((k) => k.activeCopies > 0);
  if (owned) return { kind: 'owned', album: owned };
  const previous = exact.find((k) => k.removedCopies > 0);
  if (previous) return { kind: 'previously_owned', album: previous };
  const sameName = known.find((k) => match(candidate, k) === 'same_name' && k.activeCopies > 0);
  if (sameName) return { kind: 'possible', album: sameName };
  return { kind: 'new' };
}
