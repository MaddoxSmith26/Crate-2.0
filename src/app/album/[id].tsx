/**
 * Album page: cover, artist, year, tracklist and my ratings, plus everything
 * you can do with the record (play it, log a listen, lend, borrow, remove).
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Cover } from '@/components/Cover';
import { RatingPicker } from '@/components/RatingPicker';
import { Button, Card, Empty, ErrorNote, Field, Loading, PageHeader, Pill, Screen, SectionTitle, styles as s } from '@/components/ui';
import { parseDateInput, todayInput } from '@/domain/manualEntry';
import { formatDuration, totalLengthMs } from '@/domain/nowPlaying';
import { albumProgress, formatAlbumRating, formatTrackRating, type TrackMark } from '@/domain/ratings';
import {
  addCopy, addToWishlist, clearMark, getAlbum, getTracks, listCopiesOfAlbum, listListens, listLoans, listMarks,
  listProfiles, listScoresForAlbum, listWishlist, logListen, removeCopy, requestLoan, returnLoan, saveMark, startListening,
} from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors, radius, spacing } from '@/theme/tokens';

const STATUS_LABEL = { not_started: 'Not rated yet', in_progress: 'In progress', complete: 'Complete' } as const;

export default function AlbumPage() {
  const { id, user } = useLocalSearchParams<{ id: string; user?: string }>();
  const me = useUserId();
  const router = useRouter();
  // ?user=<id> shows a family member's ratings, read-only.
  const viewing = user && user !== me ? user : me;
  const readOnlyView = viewing !== me;

  const [openTrack, setOpenTrack] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [pressingNote, setPressingNote] = useState<string | null>(null);
  const [listenDate, setListenDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const { data, error: loadError, loading, reload } = useLoad(async () => {
    const [album, tracks, marks, copies, loans, scores, profiles, listens, wishlist] = await Promise.all([
      getAlbum(id), getTracks(id), listMarks(id, viewing), listCopiesOfAlbum(id), listLoans(),
      listScoresForAlbum(id), listProfiles(), listListens(me), listWishlist(me),
    ]);
    return { album, tracks, marks, copies, loans, scores, profiles, listens, wishlist };
  }, [id, viewing, me]);

  if (loading) return <Screen><Loading /></Screen>;
  if (!data?.album) {
    return (
      <Screen>
        <PageHeader title="Album" />
        <ErrorNote message={loadError} />
        <Empty title="Album not found" />
      </Screen>
    );
  }

  const { album, tracks, copies, loans, scores, profiles } = data;
  const marks: TrackMark[] = data.marks.map((m) => ({ trackId: m.track_id, rating: m.rating, isInterlude: m.is_interlude }));
  const markFor = (trackId: string) => marks.find((m) => m.trackId === trackId);
  const progress = albumProgress(tracks.map((t) => t.id), marks);

  const myCopies = copies.filter((c) => c.owner_id === me);
  const familyCopies = copies.filter((c) => c.owner_id !== me);
  const myLoans = loans.filter((l) => l.album_id === id);
  const borrowing = myLoans.find((l) => l.borrower_id === me && l.status === 'approved');
  const canRate = !readOnlyView && (myCopies.length > 0 || Boolean(borrowing));
  const haveItNow = myCopies.some((c) => !c.lent_to) || Boolean(borrowing);
  const onWishlist = data.wishlist.some((w) => w.album_id === id);
  const myListens = data.listens.filter((l) => l.album_id === id).length;
  const viewedName = profiles.find((p) => p.id === viewing)?.display_name ?? 'Their';
  const total = totalLengthMs(tracks.map((t) => ({ trackId: t.id, lengthMs: t.length_ms })));
  const otherScores = scores.filter((sc) => sc.user_id !== viewing && sc.status !== 'not_started');

  const act = (action: () => Promise<void>, done?: string) =>
    run(async () => {
      setNotice(null);
      await action();
      await reload();
      if (done) setNotice(done);
    });

  const setRating = (trackId: string, rating: number) => act(() => saveMark(me, trackId, rating, false));
  const setInterlude = (trackId: string, on: boolean) => act(() => (on ? saveMark(me, trackId, null, true) : clearMark(me, trackId)));

  return (
    <Screen>
      <PageHeader title={album.title} subtitle={readOnlyView ? `${viewedName}'s ratings` : undefined} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
        <View style={{ width: '100%', maxWidth: 300 }}>
          <Cover uri={album.cover_url} title={album.title} artist={album.artist} size="100%" dimmed={myCopies.length > 0 && !haveItNow} />
        </View>
        <View style={{ flex: 1, minWidth: 240 }}>
          <Text style={[s.body, { fontSize: 18, color: colors.text }]}>{album.artist}</Text>
          <Text style={s.muted}>
            {album.year ?? 'Year unknown'} · {tracks.length} tracks{total ? ` · ${formatDuration(total)}` : ''}
          </Text>

          <View style={[s.row, { marginTop: spacing.md, gap: spacing.md }]}>
            <Text accessibilityLabel={`Album rating ${formatAlbumRating(progress.rating)}`} style={{ color: progress.status === 'complete' ? colors.accent : colors.textMuted, fontSize: 44, fontWeight: '800', letterSpacing: -1 }}>
              {formatAlbumRating(progress.rating)}
            </Text>
            <View>
              <Pill label={STATUS_LABEL[progress.status]} tone={progress.status === 'complete' ? 'success' : progress.status === 'in_progress' ? 'accent' : 'muted'} />
              <Text style={[s.faint, { marginTop: 4 }]}>
                {progress.ratedTracks} of {progress.countableTracks} tracks rated
                {progress.interludeTracks > 0 ? ` · ${progress.interludeTracks} interlude${progress.interludeTracks === 1 ? '' : 's'}` : ''}
              </Text>
              {progress.status === 'in_progress' ? <Text style={s.faint}>Joins the ranking once every track is rated.</Text> : null}
            </View>
          </View>

          {!readOnlyView ? (
            <View style={[s.wrap, { marginTop: spacing.md }]}>
              {haveItNow ? (
                <Button label="Play now" kind="primary" busy={busy} onPress={() => run(async () => { await startListening(id); router.push('/play'); })} />
              ) : null}
              <Button label="Log a past listen" onPress={() => setListenDate(listenDate === null ? todayInput() : null)} />
              {myCopies.length === 0 && !onWishlist ? (
                <Button label="Add to wishlist" onPress={() => act(() => addToWishlist(id), 'Added to your wishlist.')} />
              ) : null}
            </View>
          ) : null}
          <Text style={[s.faint, { marginTop: spacing.sm }]}>
            {myListens === 0 ? 'You have not logged a listen yet.' : `You have listened ${myListens} time${myListens === 1 ? '' : 's'}.`}
            {onWishlist ? ' On your wishlist.' : ''}
          </Text>

          {listenDate !== null ? (
            <Card style={{ marginTop: spacing.sm }}>
              <Field label="When did you listen?" value={listenDate} onChangeText={setListenDate} placeholder="YYYY-MM-DD" hint="Year, month, day. Today or earlier." />
              <Button
                label="Save listen"
                kind="primary"
                small
                disabled={!parseDateInput(listenDate)}
                busy={busy}
                onPress={() => {
                  const when = parseDateInput(listenDate);
                  if (when) void act(() => logListen(id, when), 'Listen logged.').then(() => setListenDate(null));
                }}
              />
            </Card>
          ) : null}
          {notice ? <Text style={[s.body, { color: colors.success, marginTop: spacing.sm }]}>{notice}</Text> : null}
          <ErrorNote message={error ?? loadError} />
        </View>
      </View>

      <SectionTitle>{readOnlyView ? `${viewedName}'s track ratings` : 'Tracks and my ratings'}</SectionTitle>
      {!canRate && !readOnlyView ? (
        <Text style={[s.muted, { marginBottom: spacing.sm }]}>
          You can rate an album while you have it: add it to your collection or borrow it.
          {marks.length > 0 ? ' Your earlier ratings are kept.' : ''}
        </Text>
      ) : null}
      {tracks.map((track, index) => {
        const mark = markFor(track.id);
        const interlude = mark?.isInterlude ?? false;
        const open = openTrack === track.id;
        return (
          <View key={track.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Track ${index + 1}, ${track.title}, ${interlude ? 'interlude' : mark?.rating != null ? `rated ${formatTrackRating(mark.rating)}` : 'not rated'}`}
              accessibilityState={{ expanded: open }}
              onPress={() => setOpenTrack(open ? null : track.id)}
              style={[s.rowBetween, { paddingVertical: 12, opacity: interlude ? 0.45 : 1 }]}>
              <Text style={{ color: colors.textFaint, width: 26, fontSize: 14 }}>{index + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.body, { fontWeight: '600' }]}>{track.title}</Text>
                <Text style={s.faint}>
                  {formatDuration(track.length_ms)}
                  {interlude ? ' · Interlude, not counted' : ''}
                </Text>
              </View>
              {interlude ? (
                <Text style={s.faint}>Interlude</Text>
              ) : mark?.rating != null ? (
                <View style={{ minWidth: 52, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.surfaceRaised, alignItems: 'center' }}>
                  <Text style={{ color: colors.accent, fontSize: 16, fontWeight: '800' }}>{formatTrackRating(mark.rating)}</Text>
                </View>
              ) : (
                <Text style={{ color: canRate ? colors.accent : colors.textFaint, fontSize: 13, fontWeight: '700' }}>{canRate ? 'Rate' : '-'}</Text>
              )}
            </Pressable>

            {open ? (
              <View style={{ paddingBottom: spacing.md, paddingLeft: 26, gap: spacing.sm }}>
                {canRate ? (
                  <>
                    {!interlude ? <RatingPicker value={mark?.rating ?? null} onChange={(rating) => setRating(track.id, rating)} disabled={busy} /> : null}
                    <View style={s.wrap}>
                      <Button
                        label={interlude ? 'Not an interlude: rate it' : 'Mark as interlude'}
                        small
                        onPress={() => setInterlude(track.id, !interlude)}
                      />
                      {mark && !interlude && mark.rating !== null ? <Button label="Clear rating" small kind="ghost" onPress={() => act(() => clearMark(me, track.id))} /> : null}
                    </View>
                    {!interlude ? null : <Text style={s.faint}>An interlude has no rating and does not count toward your album score. This is only for you.</Text>}
                  </>
                ) : null}
                <Button label="Song details" small kind="ghost" onPress={() => router.push(`/track/${track.id}`)} style={{ alignSelf: 'flex-start' }} />
              </View>
            ) : null}
          </View>
        );
      })}

      {!readOnlyView ? (
        <>
          <SectionTitle>My copies</SectionTitle>
          {borrowing ? (
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={s.rowBetween}>
                <Text style={[s.body, { flex: 1 }]}>You are borrowing this from {borrowing.owner_name}.</Text>
                <Button label="I gave it back" small onPress={() => act(() => returnLoan(borrowing.loan_id), 'Marked as returned. Your ratings stay on your ranking.')} />
              </View>
            </Card>
          ) : null}
          {myCopies.length === 0 ? (
            <View style={s.rowBetween}>
              <Text style={[s.muted, { flex: 1 }]}>You do not own a copy of this album.</Text>
              <Button label="Add to my collection" small onPress={() => act(() => addCopy(id, null), 'Added to your collection.')} />
            </View>
          ) : (
            myCopies.map((copy) => (
              <View key={copy.copy_id} style={s.listRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.body, copy.lent_to ? { color: colors.textMuted } : null]}>{copy.pressing_note || 'My copy'}</Text>
                  <Text style={copy.lent_to ? { color: colors.accent, fontSize: 13 } : s.faint}>
                    {copy.lent_to ? `Lent to ${copy.lent_to_name}` : `Added ${new Date(copy.added_at).toLocaleDateString()}`}
                  </Text>
                </View>
                {copy.lent_to && copy.loan_id ? (
                  <Button label="Got it back" small onPress={() => act(() => returnLoan(copy.loan_id!), 'Marked as returned.')} />
                ) : confirmRemove === copy.copy_id ? (
                  <View style={s.row}>
                    <Button label="Yes, remove" small kind="danger" onPress={() => act(() => removeCopy(copy.copy_id), 'Removed. Your ratings and listens are kept.').then(() => setConfirmRemove(null))} />
                    <Button label="Keep" small onPress={() => setConfirmRemove(null)} />
                  </View>
                ) : (
                  <Button label="Remove" small kind="ghost" onPress={() => setConfirmRemove(copy.copy_id)} />
                )}
              </View>
            ))
          )}
          {myCopies.length > 0 ? (
            pressingNote === null ? (
              <Button label="I have another pressing" small kind="ghost" onPress={() => setPressingNote('')} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }} />
            ) : (
              <Card style={{ marginTop: spacing.sm }}>
                <Field label="Which pressing is this one?" value={pressingNote} onChangeText={setPressingNote} placeholder="e.g. 2011 reissue, blue vinyl" maxLength={120} autoCapitalize="sentences" />
                <View style={s.row}>
                  <Button label="Add second copy" kind="primary" small disabled={pressingNote.trim().length === 0} onPress={() => act(() => addCopy(id, pressingNote), 'Second copy added.').then(() => setPressingNote(null))} />
                  <Button label="Cancel" small onPress={() => setPressingNote(null)} />
                </View>
              </Card>
            )
          ) : null}

          {familyCopies.length > 0 ? (
            <>
              <SectionTitle>In the family</SectionTitle>
              {familyCopies.map((copy) => {
                const asked = myLoans.find((l) => l.copy_id === copy.copy_id && l.borrower_id === me && l.status === 'requested');
                return (
                  <View key={copy.copy_id} style={s.listRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.body}>{copy.owner_name}'s copy{copy.pressing_note ? ` · ${copy.pressing_note}` : ''}</Text>
                      {copy.lent_to ? <Text style={{ color: colors.accent, fontSize: 13 }}>With {copy.lent_to === me ? 'you' : copy.lent_to_name}</Text> : null}
                    </View>
                    {copy.lent_to ? null : asked ? (
                      <Pill label="Asked, waiting" tone="accent" />
                    ) : (
                      <Button label="Ask to borrow" small onPress={() => act(() => requestLoan(copy.copy_id), `Asked ${copy.owner_name}. You will get a notification when they answer.`)} />
                    )}
                  </View>
                );
              })}
            </>
          ) : null}
        </>
      ) : null}

      {otherScores.length > 0 ? (
        <>
          <SectionTitle>{readOnlyView ? 'Other scores' : 'Family scores'}</SectionTitle>
          {otherScores.map((score) => {
            const name = score.user_id === me ? 'You' : (profiles.find((p) => p.id === score.user_id)?.display_name ?? 'Someone');
            return (
              <Pressable
                key={score.user_id}
                accessibilityRole="link"
                accessibilityLabel={`${name}: ${formatAlbumRating(score.rating)}, ${STATUS_LABEL[score.status]}. Open their ratings.`}
                onPress={() => router.push(score.user_id === me ? `/album/${id}` : `/album/${id}?user=${score.user_id}`)}
                style={s.listRow}>
                <Text style={[s.body, { flex: 1 }]}>{name}</Text>
                {score.status === 'in_progress' ? <Text style={s.faint}>In progress</Text> : null}
                <Text style={{ color: score.status === 'complete' ? colors.accent : colors.textMuted, fontSize: 17, fontWeight: '800' }}>{formatAlbumRating(score.rating)}</Text>
              </Pressable>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}
