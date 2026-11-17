import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button, ErrorNote, Field, Screen, styles as s } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { useAction } from '@/lib/useLoad';
import { colors, spacing } from '@/theme/tokens';

export default function SignIn() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run, clearError } = useAction();

  const creating = mode === 'up';
  const ready = email.includes('@') && password.length >= 6 && (!creating || name.trim().length > 0);

  const submit = () =>
    run(async () => {
      setNotice(null);
      if (creating) {
        const signedIn = await signUp(email, password, name);
        if (!signedIn) {
          setNotice('Almost there. Check your email for a confirmation link, then sign in.');
          setMode('in');
        }
      } else {
        await signIn(email, password);
      }
    });

  return (
    <Screen>
      <View style={{ maxWidth: 420, width: '100%', alignSelf: 'center', paddingTop: spacing.xl }}>
        <Text style={[s.label, { color: colors.accent }]}>Family record collection</Text>
        <Text style={[s.title, { fontSize: 44, letterSpacing: -1.5 }]}>Crate</Text>
        <Text style={[s.muted, { marginBottom: spacing.lg }]}>
          {creating ? 'Create your own account. Everyone in the family gets one.' : 'Sign in to flip through your records.'}
        </Text>

        {creating ? (
          <Field label="Your name" value={name} onChangeText={setName} placeholder="What the family calls you" autoCapitalize="words" maxLength={40} />
        ) : null}
        <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoComplete="email" />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 6 characters"
          secureTextEntry
          autoComplete={creating ? 'new-password' : 'current-password'}
          onSubmitEditing={() => ready && submit()}
        />

        {notice ? <Text style={[s.body, { color: colors.success, marginBottom: spacing.sm }]}>{notice}</Text> : null}
        <ErrorNote message={error} />
        <Button label={creating ? 'Create account' : 'Sign in'} kind="primary" onPress={submit} disabled={!ready} busy={busy} />
        <Button
          label={creating ? 'I already have an account' : 'Create an account'}
          kind="ghost"
          onPress={() => {
            clearError();
            setMode(creating ? 'in' : 'up');
          }}
          style={{ marginTop: spacing.sm }}
        />
      </View>
    </Screen>
  );
}
