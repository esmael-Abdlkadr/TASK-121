import { useEffect, useState } from 'react';
import { Fragment } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { notificationService } from '../services/notificationService';
import type { NotificationPrefs, NotificationTemplate } from '../types';

type Filter = 'All' | 'Unread' | 'Archived';
type Tab = 'Inbox' | 'SendLog' | 'Preferences';

export default function NotificationsPage() {
  const { currentUser } = useAuth();
  const [filter, setFilter] = useState<Filter>('All');
  const [tab, setTab] = useState<Tab>('Inbox');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);

  const isReadOnly = currentUser?.role === 'Auditor';

  useEffect(() => {
    if (!currentUser) {
      setPrefs(null);
      return;
    }

    setPrefs(notificationService.getPrefs(currentUser.id as number));
  }, [currentUser]);

  const inbox = useLiveQuery(async () => {
    if (!currentUser) {
      return [];
    }
    return notificationService.getInbox(currentUser.id as number);
  }, [currentUser]);

  const sendLog = useLiveQuery(async () => {
    if (!currentUser) {
      return [];
    }
    try {
      return await notificationService.getSendLog(currentUser);
    } catch {
      return [];
    }
  }, [currentUser]);

  if (!currentUser || !prefs) {
    return null;
  }

  const canViewSendLog = ['SystemAdministrator', 'SiteManager', 'Auditor'].includes(currentUser.role);

  const filteredInbox = (inbox ?? []).filter((row) => {
    if (filter === 'Unread') {
      return !row.isRead && row.status !== 'Archived';
    }
    if (filter === 'Archived') {
      return row.status === 'Archived';
    }
    return true;
  });

  return (
    <section className="card">
      <div className="page-header">
        <h1>Notification Center</h1>
        <div className="tab-row">
          <button className={`button ${tab === 'Inbox' ? 'primary' : 'ghost'}`} onClick={() => setTab('Inbox')}>
            Inbox
          </button>
          {canViewSendLog ? (
            <button
              className={`button ${tab === 'SendLog' ? 'primary' : 'ghost'}`}
              onClick={() => setTab('SendLog')}
            >
              Send Log
            </button>
          ) : null}
          {!isReadOnly && (
            <button
              className={`button ${tab === 'Preferences' ? 'primary' : 'ghost'}`}
              onClick={() => setTab('Preferences')}
            >
              Preferences
            </button>
          )}
        </div>
      </div>

      {tab === 'Inbox' ? (
        <>
          <div className="tab-row">
            {(['All', 'Unread', 'Archived'] as Filter[]).map((name) => (
              <button
                key={name}
                className={`button ${filter === name ? 'primary' : 'ghost'}`}
                onClick={() => setFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Subject</th>
                <th>Preview</th>
                <th>Sent At</th>
                <th>Status</th>
                <th>Read</th>
                {!isReadOnly && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {filteredInbox.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    onClick={async () => {
                      if (!isReadOnly) {
                        await notificationService.markRead(row.id as number, currentUser);
                      }
                      setExpandedId((prev) => (prev === row.id ? null : (row.id as number)));
                    }}
                    className={row.isRead ? '' : 'unread-row'}
                  >
                    <td>{row.renderedSubject || row.templateKey}</td>
                    <td>{(row.renderedBody || '').slice(0, 60)}</td>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.status}</td>
                    <td>{row.isRead ? 'Read' : 'Unread'}</td>
                    {!isReadOnly && (
                      <td>
                        <button
                          className="button ghost"
                          onClick={async (event) => {
                            event.stopPropagation();
                            await notificationService.archive(row.id as number, currentUser);
                          }}
                        >
                          Archive
                        </button>
                      </td>
                    )}
                  </tr>
                  {expandedId === row.id ? (
                    <tr>
                      <td colSpan={isReadOnly ? 5 : 6}>
                        <div className="notif-body">{row.renderedBody}</div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          {filteredInbox.length === 0 && (
            <p className="muted">No notifications to show. {filter !== 'All' ? 'Try a different filter.' : ''}</p>
          )}
        </>
      ) : null}

      {tab === 'SendLog' && canViewSendLog ? (
        <>
          <table className="table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Template</th>
                <th>Status</th>
                <th>Retries</th>
                <th>Last Attempt</th>
                <th>Failure Reason</th>
                {!isReadOnly && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {(sendLog ?? []).map((row) => (
                <tr key={row.id}>
                  <td>{row.recipientId}</td>
                  <td>{row.templateKey}</td>
                  <td>{row.status}</td>
                  <td>{row.retries}</td>
                  <td>{row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString() : '-'}</td>
                  <td>{row.failureReason || '-'}</td>
                  {!isReadOnly && (
                    <td>
                      {row.status === 'Failed' && row.retries < 3 ? (
                        <button
                          className="button ghost"
                          onClick={async () => {
                            await notificationService.manualRetry(row.id as number, currentUser);
                          }}
                        >
                          Retry Now
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {(sendLog ?? []).length === 0 && (
            <p className="muted">No messages in the send log.</p>
          )}
        </>
      ) : null}

      {tab === 'Preferences' && !isReadOnly ? (
        <div className="create-user-form">
          {(Object.keys(notificationService.TEMPLATES) as NotificationTemplate[]).map((key) => (
            <label key={key} className="pref-row">
              <input
                type="checkbox"
                checked={prefs.enabled[key]}
                onChange={(event) => {
                  const updated = {
                    ...prefs,
                    enabled: {
                      ...prefs.enabled,
                      [key]: event.target.checked
                    }
                  };
                  notificationService.savePrefs(updated);
                  setPrefs(updated);
                }}
              />
              {key}
            </label>
          ))}
          <label className="pref-row">
            <input
              type="checkbox"
              checked={prefs.showDesktopBanner}
              onChange={(event) => {
                const updated = { ...prefs, showDesktopBanner: event.target.checked };
                notificationService.savePrefs(updated);
                setPrefs(updated);
              }}
            />
            Show desktop banner
          </label>
        </div>
      ) : null}
    </section>
  );
}
