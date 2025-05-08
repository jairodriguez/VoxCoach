// app/(auth)/test-supabase/page.tsx
'use client';

import { useState } from 'react';
import { supabase } from '@/utils/supabase/client';

export default function TestSupabasePage() {
  const [user, setUser] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGetUser = async () => {
    const { data, error } = await supabase.auth.getUser();
    setUser(data?.user || null);
    setError(error ? error.message : null);
  };

  const handleSignInWithOAuth = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'http://localhost:3000/auth/callback'
      }
    });
    if (error) {
      setError(error.message);
    } else {
      handleGetUser();
    }
  };

  return (
    <div style={{ padding: 32 }}>
      <h1>Test Supabase Client</h1>
      <button onClick={handleGetUser}>Get Current User</button>
      <button onClick={handleSignInWithOAuth}>Sign In with Google</button>
      {user && (
        <pre>{JSON.stringify(user, null, 2)}</pre>
      )}
      {error && (
        <div style={{ color: 'red' }}>{error}</div>
      )}
    </div>
  );
}