import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';
import { authService } from '../services/authService';
import { cryptoService } from '../services/cryptoService';
import { notificationService } from '../services/notificationService';
import type { NavMode, User, UserRole } from '../types';

interface AuthContextValue {
  currentUser: User | null;
  navMode: NavMode;
  isRestoringSession: boolean;
  needsUnlock: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  unlock: (password: string) => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  encryptionKey: CryptoKey | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function deriveNavMode(user: User | null): NavMode {
  if (!user) {
    return 'kiosk';
  }

  return user.role === 'Attendant' || user.role === 'SiteManager' ? 'kiosk' : 'admin';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<CryptoKey | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  useEffect(() => {
    const restore = async () => {
      try {
        const user = await authService.restoreSession();
        if (user) {
          setCurrentUser(user);
          setNeedsUnlock(true);
        }
      } finally {
        setIsRestoringSession(false);
      }
    };

    void restore();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user, encryptionKey: key } = await authService.login(username, password);
    setCurrentUser(user);
    setEncryptionKey(key);
    setNeedsUnlock(false);
  }, []);

  const logout = useCallback(() => {
    authService.logout();
    notificationService.clearSchedulerState();
    setCurrentUser(null);
    setEncryptionKey(null);
    setNeedsUnlock(false);
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      if (!currentUser) {
        throw new Error('No user to unlock');
      }
      const isValid = await cryptoService.verifyPassword(
        password,
        currentUser.passwordHash,
        currentUser.salt
      );
      if (!isValid) {
        throw new Error('AUTH_WRONG_PASSWORD');
      }
      const key = await cryptoService.deriveEncryptionKey(password, currentUser.salt);
      setEncryptionKey(key);
      setNeedsUnlock(false);
    },
    [currentUser]
  );

  const hasRole = useCallback(
    (...roles: UserRole[]) => {
      if (!currentUser) {
        return false;
      }

      return roles.includes(currentUser.role);
    },
    [currentUser]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      currentUser,
      navMode: deriveNavMode(currentUser),
      isRestoringSession,
      needsUnlock,
      login,
      logout,
      unlock,
      hasRole,
      encryptionKey
    }),
    [currentUser, encryptionKey, hasRole, isRestoringSession, needsUnlock, login, logout, unlock]
  );

  return createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
