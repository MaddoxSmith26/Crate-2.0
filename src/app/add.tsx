/**
 * Add a record by searching MusicBrainz.
 * Steps: search -> pick the right result -> confirm exactly what will be saved.
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { SaveAlbumPanel, type AlbumDraft } from '@/components/SaveAlbumPanel';
import { Button, Chip, Empty, ErrorNote, Field, Loading, PageHeader, Pill, Screen, SectionTitle, styles as s } from '@/components/ui';
import { pickDefaultEdition, resultBadge, type AlbumSearchResult, type Edition, type ParsedTrack } from '@/domain/musicbrainz';
import { findAlbumByMbid, getTracks, type NewTrack } from '@/lib/api';
import { loadEditions, loadGenres, loadTracklist, searchAlbums } from '@/lib/musicbrainz';
import { useAction } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

const toNewTracks = (tracks: ParsedTrack[]): NewTrack[] =>
  tracks.map((t) => ({ disc: t.disc, position: t.position, title: t.title, length_ms: t.lengthMs, recording_mbid: t.recordingMbid }));

/** A short, distinct label for an edition, e.g. "1977 · US · 12" Vinyl · 11 tracks". */
function editionLabel(edition: Edition): string {
  return [edition.year ?? 'No date', edition.country, edition.format, `${edition.trackCount} tracks`, edition.disambiguation]
    .filter(Boolean)
    .join(' · ');
}

/** Keeps one edition per distinct label, default first, at most `limit`. */
function distinctEditions(editions: Edition[], chosen: Edition, limit = 10): Edition[] {
  const seen = new Set<string>();
  const sorted = [chosen, ...[...editions].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))];
  const out: Edition[] = [];
  for (const edition of sorted) {
    if (edition.trackCount === 0) continue;
    const label = editionLabel(edition);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(edition);
    if (out.length >= limit) break;
  }
  return out;
}

function Confirm({ result, target }: { result: AlbumSearchResult; target: 'collection' | 'wishlist' }) {
  const [draft, setDraft] = useState<AlbumDraft | null>(null);
  const [editions, setEditions] = useState<Edition[]>([]);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [status, setStatus] = useState('Looking up the album');
  const [error, setError] = useState<string | null>(null);

  const base = { mbid: result.mbid, title: result.title, artist: result.artist, year: result.year, coverUrl: result.coverUrl, loadGenres: () => loadGenres(result.mbid) };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // If a family member already added this album, use the catalog's tracklist.
        const existing = await findAlbumByMbid(result.mbid);
        if (existing) {
          const tracks = await getTracks(existing.id);
          if (cancelled) return;
          setDraft({
            ...base, existingAlbumId: existing.id, title: existing.title, artist: existing.artist, year: existing.year, coverUrl: existing.cover_url,
            tracks: tracks.map((t) => ({ disc: t.disc, position: t.position, title: t.title, length_ms: t.length_ms, recording_mbid: t.recording_mbid })),
          });
          return;
        }
        setStatus('Finding the original pressing');
        const all = await loadEditions(result.mbid);
        const chosen = pickDefaultEdition(all);
        if (!chosen) throw new Error('MusicBrainz has no tracklist for this album. You can enter it manually instead.');
        setStatus('Loading the tracklist');
        const tracks = await loadTracklist(chosen.releaseId);
        if (cancelled) return;
        setEditions(distinctEditions(all, chosen));
        setEdition(chosen);
        setDraft({ ...base, existingAlbumId: null, tracks: toNewTracks(tracks) });
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load the album.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.mbid]);

  const switchEdition = async (next: Edition) => {
    setEdition(next);
    setError(null);
    try {
      const tracks = await loadTracklist(next.releaseId);
      setDraft((current) => (current ? { ...current, tracks: toNewTracks(tracks) } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load that edition.');
    }
  };

  if (error && !draft) return <ErrorNote message={error} />;
  if (!draft) return <Loading label={status} />;

  return (
    <View>
      {editions.length > 1 && edition ? (
        <View>
          <SectionTitle>Tracklist from</SectionTitle>
          <Text style={[s.muted, { marginBottom: spacing.sm }]}>
            Crate starts with the earliest official edition. Pick another if your tracklist is different.
          </Text>
          <View style={s.wrap}>
            {editions.map((item) => (
              <Chip key={item.releaseId} label={editionLabel(item)} selected={item.releaseId === edition.releaseId} onPress={() => switchEdition(item)} />
            ))}
          </View>
          <ErrorNote message={error} />
        </View>
      ) : null}
      <SaveAlbumPanel draft={draft} target={target} />
    </View>
  );
}

export default function Add() {
  const params = useLocalSearchParams<{ to?: string }>();
  const target = params.to === 'wishlist' ? 'wishlist' : 'collection';
  const router = useRouter();
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [results, setResults] = useState<AlbumSearchResult[] | null>(null);
  const [picked, setPicked] = useState<AlbumSearchResult | null>(null);
  const { busy, error, run } = useAction();

  const search = () =>
    run(async () => {
      setPicked(null);
      setResults(await searchAlbums(artist, title));
    });
  const canSearch = artist.trim().length > 0 || title.trim().length > 0;
  const manualHref = `/add-manual?to=${target}&artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`;

  return (
    <Screen>
      <PageHeader
        title={target === 'wishlist' ? 'Add to wishlist' : 'Add a record'}
        subtitle="Search by artist and album. Crate fills in the cover, year and tracklist."
      />

      {picked ? (
        <View>
          <Button label="‹ Back to results" kind="ghost" small onPress={() => setPicked(null)} style={{ alignSelf: 'flex-start' }} />
          <Confirm key={picked.mbid} result={picked} target={target} />
        </View>
      ) : (
        <View>
          <Field label="Artist" value={artist} onChangeText={setArtist} placeholder="Fleetwood Mac" autoCapitalize="words" onSubmitEditing={() => canSearch && search()} />
          <Field label="Album title" value={title} onChangeText={setTitle} placeholder="Rumours" autoCapitalize="words" onSubmitEditing={() => canSearch && search()} />
          <Button label="Search" kind="primary" onPress={search} disabled={!canSearch} busy={busy} />
          <ErrorNote message={error} />

          {results ? (
            <View>
              <SectionTitle>{results.length === 0 ? 'No matches' : 'Pick the right one'}</SectionTitle>
              {results.length === 0 ? (
                <Empty title="Nothing found" body="Check the spelling, try just the album title, or enter it by hand." />
              ) : (
                results.map((result) => (
                  <Pressable
                    key={result.mbid}
                    accessibilityRole="button"
                    accessibilityLabel={`${result.title} by ${result.artist}, ${result.year ?? 'year unknown'}, ${resultBadge(result)}`}
                    onPress={() => setPicked(result)}
                    style={({ pressed }) => [s.listRow, { opacity: pressed ? 0.7 : 1 }]}>
                    <Cover uri={result.coverUrl} title={result.title} size={64} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{result.title}</Text>
                      <Text style={s.muted}>
                        {result.artist} · {result.year ?? 'Year unknown'}
                      </Text>
                      <View style={{ marginTop: 4 }}>
                        <Pill label={resultBadge(result)} tone={result.isOriginalAlbum ? 'accent' : 'muted'} />
                      </View>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          ) : null}

          <Button label="Can't find it? Enter it manually" kind="ghost" onPress={() => router.push(manualHref)} style={{ marginTop: spacing.lg }} />
        </View>
      )}
    </Screen>
  );
}
