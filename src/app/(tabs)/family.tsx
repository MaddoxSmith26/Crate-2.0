/** Family group: create or join, members, borrowing requests, and my account. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AlbumRow } from '@/components/AlbumRow';
import { Button, Card, ErrorNote, Field, Loading, Screen, SectionTitle, styles as s } from '@/components/ui';
import {
  cancelLoanRequest, createGroup, decideLoan, getMyGroup, joinGroup, leaveGroup, listLoans, listProfiles, returnLoan, updateDisplayName,
} from '@/lib/api';
import { useAuth, useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

export default function Family() {
  const userId = useUserId();
  const { signOut, session } = useAuth();
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [code, setCode] = useState('');
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const { busy, error, run } = useAction();

  const { data, error: loadError, loading, reload } = useLoad(
    async () => ({ group: await getMyGroup(), profiles: await listProfiles(), loans: await listLoans() }),
    [userId],
  );
  if (loading) return <Screen><Loading /></Screen>;

  const group = data?.group ?? null;
  const profiles = data?.profiles ?? [];
  const me = profiles.find((p) => p.id === userId);
  const loans = data?.loans ?? [];
  const toDecide = loans.filter((l) => l.owner_id === userId && l.status === 'requested');
  const myAsks = loans.filter((l) => l.borrower_id === userId && l.status === 'requested');
  const lentOut = loans.filter((l) => l.owner_id === userId && l.status === 'approved');
  const borrowing = loans.filter((l) => l.borrower_id === userId && l.status === 'approved');
  const act = (action: () => Promise<unknown>) => run(async () => { await action(); await reload(); });
  const daysAgo = (iso: string | null) => {
    const days = iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : 0;
    return days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  };

  return (
    <Screen>
      <ErrorNote message={error ?? loadError} />

      {group ? (
        <>
          <Text style={s.title}>{group.name}</Text>
          <Card style={{ marginTop: spacing.sm }}>
            <Text style={s.label}>Join code</Text>
            <Text selectable accessibilityLabel={`Join code ${group.join_code.split('').join(' ')}`} style={{ color: colors.accent, fontSize: 34, fontWeight: '800', letterSpacing: 6 }}>
              {group.join_code}
            </Text>
            <Text style={s.muted}>Give this code to family members. They create an account, then enter it here.</Text>
          </Card>

          <SectionTitle>Members</SectionTitle>
          {profiles.map((p) => (
            <Pressable
              key={p.id}
              accessibilityRole="link"
              accessibilityLabel={p.id === userId ? `${p.display_name}, you` : `${p.display_name}. Open their records, ranking and listening.`}
              disabled={p.id === userId}
              onPress={() => router.push(`/member/${p.id}`)}
              style={s.listRow}>
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.accent, fontWeight: '800', fontSize: 16 }}>{p.display_name.slice(0, 1).toUpperCase()}</Text>
              </View>
              <Text style={[s.body, { flex: 1, fontWeight: '600' }]}>
                {p.display_name}
                {p.id === userId ? <Text style={{ color: colors.textFaint }}>  (you)</Text> : null}
              </Text>
              {p.id === userId ? null : <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700' }}>View ›</Text>}
            </Pressable>
          ))}
          {profiles.length > 1 ? (
            <Button label="Compare rankings" small kind="ghost" onPress={() => router.push('/compare')} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }} />
          ) : null}

          {toDecide.length > 0 ? (
            <>
              <SectionTitle>Borrow requests for you</SectionTitle>
              {toDecide.map((loan) => (
                <AlbumRow
                  key={loan.loan_id} albumId={loan.album_id} title={loan.title} artist={loan.artist} coverUrl={loan.cover_url}
                  detail={`${loan.borrower_name} asked ${daysAgo(loan.requested_at)}`}
                  right={
                    <View style={s.row}>
                      <Button label="Approve" small kind="primary" busy={busy} onPress={() => act(() => decideLoan(loan.loan_id, true))} />
                      <Button label="Decline" small onPress={() => act(() => decideLoan(loan.loan_id, false))} />
                    </View>
                  }
                />
              ))}
            </>
          ) : null}

          {lentOut.length > 0 ? (
            <>
              <SectionTitle>Lent out</SectionTitle>
              {lentOut.map((loan) => (
                <AlbumRow
                  key={loan.loan_id} albumId={loan.album_id} title={loan.title} artist={loan.artist} coverUrl={loan.cover_url}
                  detail={`With ${loan.borrower_name} since ${daysAgo(loan.decided_at)}`}
                  right={<Button label="Got it back" small onPress={() => act(() => returnLoan(loan.loan_id))} />}
                />
              ))}
            </>
          ) : null}

          {borrowing.length > 0 ? (
            <>
              <SectionTitle>Borrowing</SectionTitle>
              {borrowing.map((loan) => (
                <AlbumRow
                  key={loan.loan_id} albumId={loan.album_id} title={loan.title} artist={loan.artist} coverUrl={loan.cover_url}
                  detail={`From ${loan.owner_name} since ${daysAgo(loan.decided_at)}`}
                  right={<Button label="I gave it back" small onPress={() => act(() => returnLoan(loan.loan_id))} />}
                />
              ))}
            </>
          ) : null}

          {myAsks.length > 0 ? (
            <>
              <SectionTitle>Waiting for an answer</SectionTitle>
              {myAsks.map((loan) => (
                <AlbumRow
                  key={loan.loan_id} albumId={loan.album_id} title={loan.title} artist={loan.artist} coverUrl={loan.cover_url}
                  detail={`Asked ${loan.owner_name} ${daysAgo(loan.requested_at)}`}
                  right={<Button label="Cancel" small kind="ghost" onPress={() => act(() => cancelLoanRequest(loan.loan_id))} />}
                />
              ))}
            </>
          ) : null}
        </>
      ) : (
        <>
          <Text style={s.title}>Family group</Text>
          <Text style={[s.muted, { marginBottom: spacing.md }]}>
            A group lets your family see each other's records, rankings, wishlists and listening, and borrow records.
          </Text>
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={[s.heading, { marginBottom: spacing.sm }]}>Join with a code</Text>
            <Field label="Join code" value={code} onChangeText={(text) => setCode(text.toUpperCase())} placeholder="ABC234" autoCapitalize="characters" maxLength={8} />
            <Button label="Join family group" kind="primary" disabled={code.trim().length < 6} busy={busy} onPress={() => act(() => joinGroup(code))} />
          </Card>
          <Card>
            <Text style={[s.heading, { marginBottom: spacing.sm }]}>Or start a new group</Text>
            <Field label="Group name" value={groupName} onChangeText={setGroupName} placeholder="The Smith family" autoCapitalize="words" maxLength={60} />
            <Button label="Create family group" disabled={groupName.trim().length === 0} busy={busy} onPress={() => act(() => createGroup(groupName))} />
          </Card>
        </>
      )}

      <SectionTitle>My account</SectionTitle>
      <Text style={s.body}>{me?.display_name}</Text>
      <Text style={s.muted}>{session?.user.email}</Text>
      {newName === null ? (
        <View style={[s.wrap, { marginTop: spacing.sm }]}>
          <Button label="Change my name" small onPress={() => setNewName(me?.display_name ?? '')} />
          <Button label="Sign out" small onPress={() => void signOut()} />
          {group ? (
            confirmLeave ? (
              <>
                <Button label="Yes, leave the group" small kind="danger" onPress={() => act(leaveGroup).then(() => setConfirmLeave(false))} />
                <Button label="Stay" small onPress={() => setConfirmLeave(false)} />
              </>
            ) : (
              <Button label="Leave family group" small kind="ghost" onPress={() => setConfirmLeave(true)} />
            )
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm, maxWidth: 360 }}>
          <Field label="Name the family sees" value={newName} onChangeText={setNewName} autoCapitalize="words" maxLength={40} />
          <View style={s.row}>
            <Button label="Save" kind="primary" small disabled={newName.trim().length === 0} busy={busy} onPress={() => act(() => updateDisplayName(userId, newName)).then(() => setNewName(null))} />
            <Button label="Cancel" small onPress={() => setNewName(null)} />
          </View>
        </View>
      )}
    </Screen>
  );
}
