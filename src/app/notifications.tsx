/** In-app notifications. Crate sends no email or calendar reminders. */
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { Button, Empty, ErrorNote, Loading, PageHeader, Screen, styles as s } from '@/components/ui';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/useLoad';
import { colors } from '@/theme/tokens';

export default function Notifications() {
  const userId = useUserId();
  const router = useRouter();
  const { error, run } = useAction();
  const { data, error: loadError, loading, reload } = useLoad(() => listNotifications(userId), [userId]);

  if (loading) return <Screen><Loading /></Screen>;
  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <Screen>
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}
        right={unread > 0 ? <Button label="Mark all read" small onPress={() => run(async () => { await markAllNotificationsRead(userId); await reload(); })} /> : undefined}
      />
      <ErrorNote message={error ?? loadError} />
      {items.length === 0 ? <Empty title="Nothing yet" body="Borrow requests, answers and reminders about borrowed records show up here." /> : null}
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={`${item.read_at ? '' : 'Unread. '}${item.title}. ${item.body}`}
          onPress={() =>
            run(async () => {
              if (!item.read_at) await markNotificationRead(item.id);
              if (item.kind === 'loan_requested') router.push('/family');
              else if (item.data.album_id) router.push(`/album/${item.data.album_id}`);
              else await reload();
            })
          }
          style={s.listRow}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: item.read_at ? 'transparent' : colors.accent }} />
          <View style={{ flex: 1 }}>
            <Text style={[s.body, { fontWeight: item.read_at ? '400' : '700' }]}>{item.title}</Text>
            {item.body ? <Text style={s.muted}>{item.body}</Text> : null}
            <Text style={s.faint}>{new Date(item.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</Text>
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}
