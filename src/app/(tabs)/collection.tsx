import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { AlbumGrid, type GridItem } from '@/components/AlbumGrid';
import { Button, Chip, Empty, ErrorNote, Loading, Screen, SectionTitle, styles as s } from '@/components/ui';
import { listCollection, listShelf, type CollectionItem } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useLoad } from '@/lib/useLoad';
import { spacing } from '@/theme/tokens';

/** Groups copies into one tile per album per owner ("x2" for two pressings). */
function toTiles(items: CollectionItem[], showOwner: boolean, me: string): GridItem[] {
  const tiles = new Map<string, GridItem & { copies: number; lentTo: string[] }>();
  for (const item of items) {
    const key = `${item.owner_id}:${item.album_id}`;
    const tile = tiles.get(key) ?? {
      key, albumId: item.album_id, title: item.title, artist: item.artist, coverUrl: item.cover_url, copies: 0, lentTo: [],
    };
    tile.copies += 1;
    if (item.lent_to_name) tile.lentTo.push(item.lent_to === me ? 'you' : item.lent_to_name);
    tiles.set(key, tile);
    const owner = item.owner_id === me ? 'Yours' : `${item.owner_name}'s`;
    // Greyed out only when every copy of it is out on loan.
    tile.dimmed = tile.lentTo.length >= tile.copies;
    tile.caption = tile.lentTo.length > 0 ? `${showOwner ? `${owner} · ` : ''}With ${tile.lentTo.join(', ')}` : showOwner ? owner : undefined;
    tile.badge = tile.copies > 1 ? `x${tile.copies}` : undefined;
  }
  return [...tiles.values()];
}

export default function Collection() {
  const userId = useUserId();
  const router = useRouter();
  const [view, setView] = useState<'mine' | 'family'>('mine');

  const { data, error, loading } = useLoad(
    async () => ({
      items: await listCollection(view === 'mine' ? userId : undefined),
      borrowed: view === 'mine' ? (await listShelf(userId)).filter((item) => item.borrowed) : [],
    }),
    [userId, view],
  );

  const tiles = useMemo(() => toTiles(data?.items ?? [], view === 'family', userId), [data, view, userId]);
  const borrowed: GridItem[] = (data?.borrowed ?? []).map((item) => ({
    key: `borrowed:${item.copy_id}`, albumId: item.album_id, title: item.title, artist: item.artist, coverUrl: item.cover_url,
    caption: `From ${item.owner_name}`, badge: 'Borrowed',
  }));

  return (
    <Screen>
      <View style={[s.rowBetween, { marginBottom: spacing.md, flexWrap: 'wrap' }]}>
        <View style={s.row}>
          <Chip label="My records" selected={view === 'mine'} onPress={() => setView('mine')} />
          <Chip label="Whole family" selected={view === 'family'} onPress={() => setView('family')} />
        </View>
        <Button label="Add a record" kind="primary" small onPress={() => router.push('/add')} />
      </View>

      <ErrorNote message={error} />
      {loading ? (
        <Loading />
      ) : tiles.length === 0 && borrowed.length === 0 ? (
        <Empty
          title={view === 'mine' ? 'Your crate is empty' : 'No records in the family yet'}
          body="Search for an album you own and Crate fills in the cover, year and tracklist."
          action={<Button label="Add your first record" kind="primary" onPress={() => router.push('/add')} />}
        />
      ) : (
        <>
          {borrowed.length > 0 ? (
            <>
              <SectionTitle>Borrowing right now</SectionTitle>
              <AlbumGrid items={borrowed} />
              <SectionTitle>My records</SectionTitle>
            </>
          ) : null}
          <AlbumGrid items={tiles} />
          <Text style={[s.faint, { marginTop: spacing.lg }]}>
            {tiles.length} {tiles.length === 1 ? 'album' : 'albums'}
            {view === 'family' ? ' across the family' : ''}
          </Text>
        </>
      )}
    </Screen>
  );
}
