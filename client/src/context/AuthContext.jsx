import { createContext, useContext, useEffect, useState } from 'react';
import {
  signIn,
  signOut,
  signUp,
  autoSignIn,
  getCurrentUser,
  fetchUserAttributes,
} from 'aws-amplify/auth';

const AuthContext = createContext(null);

async function loadCurrentUser() {
  const { userId } = await getCurrentUser();
  const attrs = await fetchUserAttributes();
  return {
    id: userId,
    email: attrs.email,
    displayName: attrs.nickname || attrs.email,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    await signIn({ username: email, password });
    const u = await loadCurrentUser();
    setUser(u);
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
    if (!isSignUpComplete && nextStep?.signUpStep === 'COMPLETE_AUTO_SIGN_IN') {
      await autoSignIn();
    } else if (!isSignUpComplete) {
      throw new Error(
        'Account created but additional confirmation is required. Check your email.'
      );
    }
    const u = await loadCurrentUser();
    setUser(u);
  };

  const logout = async () => {
    await signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
