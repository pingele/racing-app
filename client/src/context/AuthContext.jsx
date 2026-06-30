import { createContext, useContext, useEffect, useState } from 'react';
import {
  signIn,
  signOut,
  signUp,
  autoSignIn,
  getCurrentUser,
  fetchUserAttributes,
  fetchAuthSession,
} from 'aws-amplify/auth';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

async function loadCurrentUser() {
  const { userId } = await getCurrentUser();
  // Force-refresh so a freshly-added group claim (e.g. Admins) is present.
  const session = await fetchAuthSession({ forceRefresh: true });
  const attrs = await fetchUserAttributes();
  const groups = session.tokens?.idToken?.payload?.['cognito:groups'] ?? [];
  return {
    id: userId,
    email: attrs.email,
    displayName: attrs.nickname || attrs.email,
    isAdmin: Array.isArray(groups) && groups.includes('Admins'),
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const hydrate = async () => {
    const u = await loadCurrentUser();
    setUser(u);
    // Keep an app-level profile row in sync (user storage).
    api.upsertProfile(u).catch(() => {});
    return u;
  };

  useEffect(() => {
    hydrate()
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    await signIn({ username: email, password });
    return hydrate();
  };

  const register = async (email, password, displayName) => {
    const { isSignUpComplete, nextStep } = await signUp({
      username: email,
      password,
      options: {
        userAttributes: { email, nickname: displayName },
        autoSignIn: true,
      },
    });
    // With the auto-confirm trigger, signUp returns isSignUpComplete=true while
    // the next step is still COMPLETE_AUTO_SIGN_IN — so gate on the step, not on
    // isSignUpComplete, or the user is never actually signed in.
    if (nextStep?.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
      await autoSignIn();
    } else if (!isSignUpComplete) {
      throw new Error(
        'Account created but additional confirmation is required. Check your email.',
      );
    }
    return hydrate();
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, isAdmin: !!user?.isAdmin, login, register, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
