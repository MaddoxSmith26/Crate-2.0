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
  | { kind: 'previously_owned'; album: KnownAlbum };

function matches(candidate: AlbumIdentity, known: AlbumIdentity): boolean {
  if (candidate.mbid && known.mbid && candidate.mbid === known.mbid) return true;
  return albumKey(candidate.artist, candidate.title) === albumKey(known.artist, known.title);
}

/**
 * Checks a candidate album against one person's known albums.
 * A currently owned match wins over a previously owned one.
 */
export function checkDuplicate(candidate: AlbumIdentity, known: readonly KnownAlbum[]): DuplicateCheck {
  const hits = known.filter((k) => matches(candidate, k));
  const owned = hits.find((k) => k.activeCopies > 0);
  if (owned) return { kind: 'owned', album: owned };
  const previous = hits.find((k) => k.removedCopies > 0);
  if (previous) return { kind: 'previously_owned', album: previous };
  return { kind: 'new' };
}
