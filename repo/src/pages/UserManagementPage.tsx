import { FormEvent, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { userService } from '../services/userService';
import type { UserRole } from '../types';

const USER_ROLES: UserRole[] = ['SystemAdministrator', 'SiteManager', 'Attendant', 'Auditor'];

function formatLockedUntil(lockedUntil?: number): string {
  if (!lockedUntil) {
    return 'No';
  }

  const now = Date.now();
  if (lockedUntil <= now) {
    return 'No';
  }

  const minutes = Math.ceil((lockedUntil - now) / 60_000);
  return `Yes (${minutes}m left)`;
}

export default function UserManagementPage() {
  const { currentUser } = useAuth();
  const users = useLiveQuery(() => db.users.orderBy('username').toArray(), []);
  const sites = useLiveQuery(() => db.sites.toArray(), []);

  const [createError, setCreateError] = useState<string | null>(null);
  const [passwordResetInput, setPasswordResetInput] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    role: 'Attendant' as UserRole,
    siteId: ''
  });

  const siteOptions = useMemo(() => sites ?? [], [sites]);

  if (!currentUser) {
    return null;
  }

  const onCreateUser = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setCreateError(null);
    setBusy(true);

    try {
      await userService.createUser(currentUser, {
        username: newUser.username.trim(),
        password: newUser.password,
        role: newUser.role,
        siteId: newUser.role === 'SystemAdministrator' ? undefined : Number(newUser.siteId)
      });

      setNewUser({ username: '', password: '', role: 'Attendant', siteId: '' });
    } catch (error) {
      if (error instanceof Error && error.message === 'USER_ALREADY_EXISTS') {
        setCreateError('Username already exists.');
      } else if (error instanceof Error && error.message === 'PASSWORD_TOO_SHORT') {
        setCreateError('Password must be at least 12 characters.');
      } else {
        setCreateError('Unable to create user.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h1>User Management</h1>
      <p className="muted">Local user account operations for system administration.</p>

      <table className="table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Role</th>
            <th>Site</th>
            <th>Locked</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {(users ?? []).map((user) => (
            <tr key={user.id}>
              <td>{user.username}</td>
              <td>{user.role}</td>
              <td>{user.siteId ?? '-'}</td>
              <td>{formatLockedUntil(user.lockedUntil)}</td>
              <td>
                <div className="user-actions">
                  <input
                    type="password"
                    placeholder="New password"
                    value={passwordResetInput[user.id as number] ?? ''}
                    onChange={(event) =>
                      setPasswordResetInput((previous) => ({
                        ...previous,
                        [user.id as number]: event.target.value
                      }))
                    }
                  />
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const value = passwordResetInput[user.id as number] ?? '';
                      if (!value) return;
                      setBusy(true);
                      try {
                        await userService.resetPassword(currentUser, user.id as number, value);
                        setPasswordResetInput((previous) => ({ ...previous, [user.id as number]: '' }));
                      } finally { setBusy(false); }
                    }}
                  >
                    Reset Password
                  </button>
                  <button
                    className="button ghost"
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try { await userService.unlockAccount(currentUser, user.id as number); } finally { setBusy(false); }
                    }}
                  >
                    Unlock Account
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Create User</h2>
      <form className="create-user-form" onSubmit={onCreateUser}>
        <input
          placeholder="Username"
          value={newUser.username}
          onChange={(event) => setNewUser((previous) => ({ ...previous, username: event.target.value }))}
          required
        />
        <input
          type="password"
          placeholder="Password (min 12 chars)"
          value={newUser.password}
          onChange={(event) => setNewUser((previous) => ({ ...previous, password: event.target.value }))}
          required
        />
        <select
          value={newUser.role}
          onChange={(event) =>
            setNewUser((previous) => ({ ...previous, role: event.target.value as UserRole }))
          }
        >
          {USER_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        <select
          value={newUser.siteId}
          disabled={newUser.role === 'SystemAdministrator'}
          onChange={(event) => setNewUser((previous) => ({ ...previous, siteId: event.target.value }))}
          required={newUser.role !== 'SystemAdministrator'}
        >
          <option value="">Select site</option>
          {siteOptions.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
        <button className="button primary" type="submit" disabled={busy}>
          {busy ? 'Creating...' : 'Create User'}
        </button>
      </form>

      {createError ? <p className="error">{createError}</p> : null}
    </section>
  );
}
