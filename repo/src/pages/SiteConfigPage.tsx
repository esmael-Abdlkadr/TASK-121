import { FormEvent, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { siteConfigService } from '../services/siteConfigService';
import { storageService } from '../services/storageService';

export default function SiteConfigPage() {
  const { currentUser } = useAuth();
  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const isGlobal = currentUser?.role === 'SystemAdministrator';
  const [selectedSite, setSelectedSite] = useState<number>(() => {
    if (!isGlobal) return currentUser?.siteId ?? 1;
    return storageService.getLastSite() ?? 1;
  });
  const siteId = isGlobal ? selectedSite : (currentUser?.siteId ?? 1);

  const [config, setConfig] = useState(() => siteConfigService.getSiteConfig(siteId));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void siteConfigService.loadSiteConfig(siteId).then(setConfig);
  }, [siteId]);

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    void siteConfigService.saveSiteConfig(config, currentUser ?? undefined).then(() => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    });
  };

  return (
    <section className="card">
      <h1>Site Config</h1>
      {isGlobal && (
        <div className="filters-row">
          <label>
            Site:{' '}
            <select
              value={selectedSite}
              onChange={(e) => {
                const id = Number(e.target.value);
                setSelectedSite(id);
                storageService.setLastSite(id);
              }}
            >
              {(sites ?? []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      <form className="create-user-form" onSubmit={onSave}>
        <label htmlFor="tempLeaveMaxCount">tempLeaveMaxCount</label>
        <input
          id="tempLeaveMaxCount"
          type="number"
          min={1}
          value={config.tempLeaveMaxCount}
          onChange={(event) =>
            setConfig((previous) => ({ ...previous, tempLeaveMaxCount: Number(event.target.value) }))
          }
        />

        <label htmlFor="tempLeaveMaxMinutes">tempLeaveMaxMinutes</label>
        <input
          id="tempLeaveMaxMinutes"
          type="number"
          min={1}
          value={config.tempLeaveMaxMinutes}
          onChange={(event) =>
            setConfig((previous) => ({ ...previous, tempLeaveMaxMinutes: Number(event.target.value) }))
          }
        />

        <label htmlFor="anomalyHeartbeatTimeoutMin">anomalyHeartbeatTimeoutMin</label>
        <input
          id="anomalyHeartbeatTimeoutMin"
          type="number"
          min={1}
          value={config.anomalyHeartbeatTimeoutMin}
          onChange={(event) =>
            setConfig((previous) => ({ ...previous, anomalyHeartbeatTimeoutMin: Number(event.target.value) }))
          }
        />

        <label htmlFor="noShowGraceMinutes">noShowGraceMinutes</label>
        <input
          id="noShowGraceMinutes"
          type="number"
          min={1}
          value={config.noShowGraceMinutes}
          onChange={(event) =>
            setConfig((previous) => ({ ...previous, noShowGraceMinutes: Number(event.target.value) }))
          }
        />

        <label htmlFor="ratePerMinute">ratePerMinute (USD)</label>
        <input
          id="ratePerMinute"
          type="number"
          min={0.01}
          step={0.01}
          value={config.ratePerMinute}
          onChange={(event) =>
            setConfig((previous) => ({ ...previous, ratePerMinute: Number(event.target.value) }))
          }
        />

        <button className="button primary" type="submit">
          Save
        </button>
      </form>
      {saved ? <p>Saved.</p> : null}
    </section>
  );
}
