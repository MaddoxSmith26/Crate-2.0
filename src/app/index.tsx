import { Redirect } from 'expo-router';

import { useAuth } from '@/lib/auth';

/** Landing route: on to the collection when signed in, otherwise to sign-in. */
export default function Index() {
  const { session } = useAuth();
  return <Redirect href={session ? '/collection' : '/sign-in'} />;
}
