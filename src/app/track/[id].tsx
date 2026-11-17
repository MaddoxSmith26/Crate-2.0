/**
 * Song details (later phase): credits and background, fetched live.
 * Lyrics are never shown or stored in Crate. The button links out.
 */
import { useLocalSearchParams } from 'expo-router';
import { Linking, Text, View } from 'react-native';

import { Button, Card, Empty, Loading, PageHeader, Screen, SectionTitle, styles as s } from '@/components/ui';
import { buildWikipediaSearchUrl, parseWikipediaSearch, pickSongArticle } from '@/domain/background';
import { lyricsSearchUrl, type SongCredits } from '@/domain/musicbrainz';
import { formatDuration } from '@/domain/nowPlaying';
import { getAlbum, getTrack } from '@/lib/api';
import { loadCredits } from '@/lib/musicbrainz';
import { useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

function CreditGroup({ title, lines }: { title: string; lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[s.label, { marginBottom: 4 }]}>{title}</Text>
      {lines.map((line) => (
        <Text key={line} style={s.body}>{line}</Text>
      ))}
    </View>
  );
}

export default function TrackPage() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const base = useLoad(async () => {
    const track = await getTrack(id);
    const album = track ? await getAlbum(track.album_id) : null;
    return { track, album };
  }, [id]);
  const track = base.data?.track ?? null;
  const album = base.data?.album ?? null;

  // Credits and background load separately so one failing does not hide the other.
  const credits = useLoad<SongCredits | null>(async () => (track?.recording_mbid ? loadCredits(track.recording_mbid) : null), [track?.recording_mbid]);
  const background = useLoad(async () => {
    if (!track || !album) return null;
    const response = await fetch(buildWikipediaSearchUrl(album.artist, track.title));
    if (!response.ok) throw new Error('Wikipedia is not answering right now.');
    return pickSongArticle(parseWikipediaSearch(await response.json()), album.artist, track.title);
  }, [track?.id, album?.id]);

  if (base.loading) return <Screen><Loading /></Screen>;
  if (!track || !album) {
    return (
      <Screen>
        <PageHeader title="Song" />
        <Empty title="Song not found" />
      </Screen>
    );
  }

  const c = credits.data;
  const hasCredits = c && (c.writers.length || c.producers.length || c.players.length || c.engineers.length);

  return (
    <Screen>
      <PageHeader title={track.title} subtitle={`${album.artist} · ${album.title} · ${formatDuration(track.length_ms)}`} />

      <SectionTitle>What it is about</SectionTitle>
      {background.loading ? (
        <Loading label="Looking for background" />
      ) : background.data ? (
        <Card>
          <Text style={s.body}>{background.data.extract}</Text>
          <Button label={`Read more on Wikipedia: ${background.data.title}`} kind="ghost" small onPress={() => void Linking.openURL(background.data!.url)} style={{ alignSelf: 'flex-start', marginTop: spacing.sm }} />
          <Text style={s.faint}>Summary from Wikipedia, CC BY-SA.</Text>
        </Card>
      ) : (
        <Text style={s.muted}>{background.error ?? 'No background found for this song.'}</Text>
      )}

      <SectionTitle>Credits</SectionTitle>
      {!track.recording_mbid ? (
        <Text style={s.muted}>Credits are available for albums added through search.</Text>
      ) : credits.loading ? (
        <Loading label="Loading credits" />
      ) : hasCredits ? (
        <View>
          <CreditGroup title="Written by" lines={c.writers} />
          <CreditGroup title="Players" lines={c.players.map((p) => `${p.name}: ${p.roles.join(', ')}`)} />
          <CreditGroup title="Produced by" lines={c.producers} />
          <CreditGroup title="Engineered by" lines={c.engineers} />
          <Text style={s.faint}>Credits from MusicBrainz.</Text>
        </View>
      ) : (
        <Text style={s.muted}>{credits.error ?? 'MusicBrainz has no credits for this recording yet.'}</Text>
      )}

      <SectionTitle>Lyrics</SectionTitle>
      <Text style={[s.muted, { marginBottom: spacing.sm }]}>Crate does not show or store lyrics. This opens a licensed lyrics site.</Text>
      <Button label="Find lyrics on Genius" onPress={() => void Linking.openURL(lyricsSearchUrl(album.artist, track.title))} style={{ alignSelf: 'flex-start' }} />
      <Text style={{ color: colors.textFaint, fontSize: 12, marginTop: spacing.sm }}>Opens genius.com in your browser.</Text>
    </Screen>
  );
}
