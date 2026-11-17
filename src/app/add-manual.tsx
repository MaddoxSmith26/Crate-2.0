/** Enter an album by hand when search cannot find it. */
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { SaveAlbumPanel, type AlbumDraft } from '@/components/SaveAlbumPanel';
import { Button, ErrorNote, Field, PageHeader, Screen } from '@/components/ui';
import { parseManualTracks, parseYearInput } from '@/domain/manualEntry';

export default function AddManual() {
  const params = useLocalSearchParams<{ to?: string; artist?: string; title?: string }>();
  const target = params.to === 'wishlist' ? 'wishlist' : 'collection';
  const [artist, setArtist] = useState(params.artist ?? '');
  const [title, setTitle] = useState(params.title ?? '');
  const [year, setYear] = useState('');
  const [trackText, setTrackText] = useState('');
  const [draft, setDraft] = useState<AlbumDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const review = () => {
    const tracks = parseManualTracks(trackText);
    const parsedYear = parseYearInput(year);
    if (!artist.trim() || !title.trim()) return setError('Enter the artist and the album title.');
    if (!parsedYear.valid) return setError('Enter the year as four digits, like 1977, or leave it empty.');
    if (tracks.length === 0) return setError('Enter at least one track, one per line.');
    setError(null);
    setDraft({
      existingAlbumId: null, mbid: null, title: title.trim(), artist: artist.trim(), year: parsedYear.year, coverUrl: null,
      tracks: tracks.map((t) => ({ disc: 1, position: t.position, title: t.title, length_ms: t.lengthMs, recording_mbid: null })),
    });
  };

  return (
    <Screen>
      <PageHeader title="Enter it manually" subtitle="For albums search cannot find. Manual albums have no cover art." />
      {draft ? (
        <View>
          <Button label="‹ Edit details" kind="ghost" small onPress={() => setDraft(null)} style={{ alignSelf: 'flex-start' }} />
          <SaveAlbumPanel draft={draft} target={target} />
        </View>
      ) : (
        <View>
          <Field label="Artist" value={artist} onChangeText={setArtist} autoCapitalize="words" />
          <Field label="Album title" value={title} onChangeText={setTitle} autoCapitalize="words" />
          <Field label="Year (optional)" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} placeholder="1977" />
          <Field
            label="Tracks, one per line"
            value={trackText}
            onChangeText={setTrackText}
            multiline
            autoCapitalize="sentences"
            placeholder={'Second Hand News 2:43\nDreams 4:14\nNever Going Back Again'}
            hint="Add a length like 4:14 at the end of a line if you know it. Lengths let Crate guess which song is playing."
          />
          <ErrorNote message={error} />
          <Button label="Review before saving" kind="primary" onPress={review} />
        </View>
      )}
    </Screen>
  );
}
