/**
 * The last step of adding a record, shared by search and manual entry.
 *
 * It shows exactly what is about to be saved, checks whether the person
 * already owns the album, and only then saves. A second copy is offered only
 * as "another pressing", never created by accident.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { checkDuplicate, type DuplicateCheck } from '@/domain/duplicates';
import { albumKey } from '@/domain/normalize';
import { formatDuration, totalLengthMs } from '@/domain/nowPlaying';
import { addCopy, addToWishlist, listOwnedAlbums, upsertAlbum, type NewTrack } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

import { Cover } from './Cover';
import { Button, Card, ErrorNote, Field, Loading, SectionTitle, styles as s } from './ui';

export interface AlbumDraft {
  /** Already in Crate's catalog: save a copy of this album as it is. */
  existingAlbumId: string | null;
  mbid: string | null;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  tracks: NewTrack[];
  /** Fetched just before saving, so a slow genre lookup never blocks the preview. */
  loadGenres?: () => Promise<string[]>;
}

export function SaveAlbumPanel({ draft, target }: { draft: AlbumDraft; target: 'collection' | 'wishlist' }) {
  const userId = useUserId();
  const router = useRouter();
  const [note, setNote] = useState('');
  const [anotherPressing, setAnotherPressing] = useState(false);
  const [treatAsDifferent, setTreatAsDifferent] = useState(false);
  const { busy, error, run } = useAction();

  const owned = useLoad(() => listOwnedAlbums(userId), [userId]);
  if (owned.loading) return <Loading label="Checking your collection" />;

  const known = (owned.data ?? []).map((o) => ({
    albumId: o.album_id, mbid: o.mbid, artist: o.artist, title: o.title, activeCopies: o.active_copies, removedCopies: o.removed_copies,
  }));
  let check: DuplicateCheck = checkDuplicate({ mbid: draft.mbid, artist: draft.artist, title: draft.title }, known);
  if (check.kind === 'possible' && treatAsDifferent) check = { kind: 'new' };

  /** Saves the album to the catalog if needed and returns its ID. */
  const ensureAlbum = async (): Promise<string> => {
    if (check.kind === 'owned' || check.kind === 'previously_owned') return check.album.albumId;
    if (draft.existingAlbumId) return draft.existingAlbumId;
    const genres = draft.loadGenres ? await draft.loadGenres().catch(() => []) : [];
    return upsertAlbum(
      {
        mbid: draft.mbid, title: draft.title, artist: draft.artist, year: draft.year, cover_url: draft.coverUrl,
        album_key: albumKey(draft.artist, draft.title), genres,
      },
      draft.tracks,
    );
  };

  const save = () =>
    run(async () => {
      const albumId = await ensureAlbum();
      if (target === 'wishlist') await addToWishlist(albumId);
      else await addCopy(albumId, note);
      router.replace(target === 'wishlist' ? '/wishlist' : `/album/${albumId}`);
    });

  const total = totalLengthMs(draft.tracks.map((t) => ({ trackId: String(t.position), lengthMs: t.length_ms })));

  return (
    <View>
      <SectionTitle>{target === 'wishlist' ? 'About to add to your wishlist' : 'About to add to your collection'}</SectionTitle>
      <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>
        <Cover uri={draft.coverUrl} title={draft.title} artist={draft.artist} size={150} />
        <View style={{ flex: 1, minWidth: 180 }}>
          <Text style={s.title}>{draft.title}</Text>
          <Text style={[s.body, { color: colors.textMuted }]}>{draft.artist}</Text>
          <Text style={s.muted}>
            {draft.year ?? 'Year unknown'} · {draft.tracks.length} tracks{total ? ` · ${formatDuration(total)}` : ''}
          </Text>
          {draft.existingAlbumId ? <Text style={[s.faint, { marginTop: spacing.xs }]}>Already in Crate's catalog, so its tracklist is set.</Text> : null}
        </View>
      </View>

      <View style={{ marginTop: spacing.md }}>
        {draft.tracks.map((track, index) => (
          <View key={`${track.disc}-${track.position}`} style={[s.rowBetween, { paddingVertical: 5 }]}>
            <Text style={[s.body, { flex: 1 }]} numberOfLines={1}>
              <Text style={{ color: colors.textFaint }}>{index + 1}.  </Text>
              {track.title}
            </Text>
            <Text style={s.faint}>{formatDuration(track.length_ms)}</Text>
          </View>
        ))}
      </View>

      <View style={{ marginTop: spacing.lg }}>
        <ErrorNote message={error ?? owned.error} />

        {target === 'wishlist' ? (
          check.kind === 'owned' ? (
            <Card>
              <Text style={s.heading}>You already own this album</Text>
              <Text style={s.muted}>It does not need to be on your wishlist.</Text>
              <Button label="Open it in my collection" onPress={() => router.replace(`/album/${check.album.albumId}`)} style={{ marginTop: spacing.sm }} />
            </Card>
          ) : (
            <Button label="Add to my wishlist" kind="primary" onPress={save} busy={busy} />
          )
        ) : check.kind === 'owned' && !anotherPressing ? (
          <Card>
            <Text style={s.heading}>You already own this album</Text>
            <Text style={s.muted}>
              {check.album.title} is in your collection{check.album.activeCopies > 1 ? ` (${check.album.activeCopies} copies)` : ''}. Crate will not add it twice.
            </Text>
            <View style={[s.wrap, { marginTop: spacing.md }]}>
              <Button label="Open it in my collection" kind="primary" onPress={() => router.replace(`/album/${check.album.albumId}`)} />
              <Button label="I have another pressing" onPress={() => setAnotherPressing(true)} />
            </View>
          </Card>
        ) : check.kind === 'possible' ? (
          <Card>
            <Text style={s.heading}>Is this the same album?</Text>
            <Text style={s.muted}>
              You already have an album called {check.album.title} by {check.album.artist}. Some artists have several albums with the same name.
            </Text>
            <View style={[s.wrap, { marginTop: spacing.md }]}>
              <Button label="Same album: open mine" onPress={() => router.replace(`/album/${check.album.albumId}`)} />
              <Button label="Different album: add it" kind="primary" onPress={() => setTreatAsDifferent(true)} />
            </View>
          </Card>
        ) : (
          <View>
            {check.kind === 'owned' ? (
              <Text style={[s.body, { marginBottom: spacing.sm }]}>Adding a second copy of an album you own. It stays one album with two copies.</Text>
            ) : null}
            {check.kind === 'previously_owned' ? (
              <Text style={[s.body, { marginBottom: spacing.sm }]}>You owned this before. Adding it again brings back your ratings and listens.</Text>
            ) : null}
            <Field
              label={check.kind === 'owned' ? 'Which pressing is this one?' : 'Pressing note (optional)'}
              value={note}
              onChangeText={setNote}
              placeholder="e.g. 1977 original, 2011 reissue, blue vinyl"
              maxLength={120}
              autoCapitalize="sentences"
            />
            <Button
              label={check.kind === 'owned' ? 'Add second copy' : 'Add to my collection'}
              kind="primary"
              onPress={save}
              busy={busy}
              disabled={check.kind === 'owned' && note.trim().length === 0}
            />
          </View>
        )}
      </View>
    </View>
  );
}
