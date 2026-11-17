/**
 * My wishlist, and the family's wishlists where gifts can be claimed.
 * On my own wishlist the database never returns claims, so there is nothing
 * here that could give a surprise away.
 */
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { AlbumRow } from '@/components/AlbumRow';
import { Button, Empty, ErrorNote, Loading, Pill, Screen, SectionTitle, styles as s } from '@/components/ui';
import { addCopy, cancelClaim, claimWishlistItem, listWishlist, removeFromWishlist, type WishlistRow } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

export default function Wishlist() {
  const userId = useUserId();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const { data, error: loadError, loading, reload } = useLoad(() => listWishlist(), [userId]);

  if (loading) return <Screen><Loading /></Screen>;
  const rows = data ?? [];
  const mine = rows.filter((r) => r.user_id === userId);
  const byMember = new Map<string, WishlistRow[]>();
  for (const row of rows) {
    if (row.user_id === userId) continue;
    byMember.set(row.user_name, [...(byMember.get(row.user_name) ?? []), row]);
  }
  const act = (action: () => Promise<void>) => run(async () => { await action(); await reload(); });

  return (
    <Screen>
      <View style={[s.rowBetween, { marginBottom: spacing.sm }]}>
        <Text style={s.title}>My wishlist</Text>
        <Button label="Add an album" kind="primary" small onPress={() => router.push('/add?to=wishlist')} />
      </View>
      <ErrorNote message={error ?? loadError} />

      {mine.length === 0 ? (
        <Empty title="Nothing on your wishlist" body="Add albums you want. Your family can see the list and quietly call dibs on a gift." />
      ) : (
        mine.map((row) => (
          <AlbumRow
            key={row.item_id}
            albumId={row.album_id}
            title={row.title}
            artist={row.artist}
            coverUrl={row.cover_url}
            detail={row.year ? String(row.year) : undefined}
            right={
              <View style={s.row}>
                <Button label="I got it" small busy={busy} onPress={() => act(() => addCopy(row.album_id, null))} />
                <Button label="Remove" small kind="ghost" onPress={() => act(() => removeFromWishlist(row.item_id))} />
              </View>
            }
          />
        ))
      )}
      {mine.length > 0 ? <Text style={[s.faint, { marginTop: spacing.sm }]}>"I got it" adds a copy to your collection, which takes the album off this list.</Text> : null}

      {[...byMember.entries()].map(([name, items]) => (
        <View key={name}>
          <SectionTitle>{name}'s wishlist</SectionTitle>
          {items.map((row) => {
            const claimedByMe = row.claimer_id === userId;
            return (
              <AlbumRow
                key={row.item_id}
                albumId={row.album_id}
                title={row.title}
                artist={row.artist}
                coverUrl={row.cover_url}
                detail={
                  claimedByMe && row.claim_expires_at
                    ? `Your claim lasts until ${new Date(row.claim_expires_at).toLocaleDateString()}`
                    : row.claim_id
                      ? `${row.claimer_name} is getting this`
                      : undefined
                }
                right={
                  claimedByMe ? (
                    <View style={[s.row, { flexWrap: 'wrap', justifyContent: 'flex-end' }]}>
                      <Pill label="You're getting this" tone="success" />
                      <Button label="Cancel" small kind="ghost" onPress={() => act(() => cancelClaim(row.claim_id!))} />
                    </View>
                  ) : row.claim_id ? (
                    <Pill label="Taken" />
                  ) : (
                    <Button label="I'm getting this" small busy={busy} onPress={() => act(() => claimWishlistItem(row.item_id))} />
                  )
                }
              />
            );
          })}
          <Text style={[s.faint, { marginTop: spacing.xs }]}>
            {name} cannot see who is getting what. <Text style={{ color: colors.textMuted }}>A claim clears itself after one month.</Text>
          </Text>
        </View>
      ))}
    </Screen>
  );
}
