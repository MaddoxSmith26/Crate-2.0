/**
 * The five main sections with a text tab bar along the bottom, like the
 * dividers in a record crate. The header carries the notifications bell.
 */
import { Slot, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listNotifications, refreshLoanReminders } from '@/lib/api';
import { useUserId } from '@/lib/auth';
import { useLoad } from '@/lib/useLoad';
import { colors, maxContentWidth, spacing } from '@/theme/tokens';

const TABS = [
  { path: '/collection', label: 'Collection' },
  { path: '/ranking', label: 'Ranking' },
  { path: '/play', label: 'Play' },
  { path: '/wishlist', label: 'Wishlist' },
  { path: '/family', label: 'Family' },
] as const;

export default function TabsLayout() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const userId = useUserId();

  // Borrowing reminders are created when the app opens (no background jobs in version one).
  useEffect(() => {
    refreshLoanReminders().catch(() => undefined);
  }, []);

  const notifications = useLoad(() => listNotifications(userId), [userId, pathname]);
  const unread = (notifications.data ?? []).filter((n) => !n.read_at).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ paddingTop: insets.top, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <View style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: spacing.md, height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: '800', letterSpacing: -0.8 }}>Crate</Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8, paddingLeft: 12 }}>
            <Text style={{ color: unread > 0 ? colors.accent : colors.textMuted, fontSize: 13, fontWeight: '700' }}>Notifications</Text>
            {unread > 0 ? (
              <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}>
                <Text style={{ color: colors.accentText, fontSize: 11, fontWeight: '800' }}>{unread}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <Slot />
      </View>

      <View style={{ borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, paddingBottom: insets.bottom }}>
        <View accessibilityRole="tablist" style={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row' }}>
          {TABS.map((tab) => {
            const active = pathname === tab.path;
            return (
              <Pressable
                key={tab.path}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: active }}
                onPress={() => router.replace(tab.path)}
                style={{ flex: 1, height: 54, alignItems: 'center', justifyContent: 'center', borderTopWidth: 2, borderTopColor: active ? colors.accent : 'transparent' }}>
                <Text numberOfLines={1} style={{ color: active ? colors.accent : colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}
