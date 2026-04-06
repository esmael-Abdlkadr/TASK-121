import { Fragment, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { useAuth } from '../hooks/useAuth';
import { qualityService } from '../services/qualityService';
import { storageService } from '../services/storageService';
import type { QualityReport } from '../types';

type Tab = 'Reports' | 'Export';

export default function DataQualityPage() {
  const { currentUser } = useAuth();
  const [tab, setTab] = useState<Tab>('Reports');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const sites = useLiveQuery(() => db.sites.toArray(), []);
  const isGlobal = currentUser?.role === 'SystemAdministrator';
  const [selectedSite, setSelectedSite] = useState<number>(() => {
    if (!isGlobal) return currentUser?.siteId ?? 1;
    return storageService.getLastSite() ?? 1;
  });

  const siteId = isGlobal ? selectedSite : (currentUser?.siteId as number);

  const reports = useLiveQuery(async () => {
    if (!currentUser) {
      return [];
    }
    return db.qualityReports.where('siteId').equals(siteId).reverse().sortBy('generatedAt');
  }, [currentUser, siteId]);

  const selected = useMemo(
    () => (reports ?? []).find((report) => report.id === selectedId) ?? null,
    [reports, selectedId]
  );

  if (!currentUser) {
    return null;
  }

  return (
    <section className="card">
      <div className="page-header">
        <h1>Data Quality</h1>
        <div className="tab-row">
          <button className={`button ${tab === 'Reports' ? 'primary' : 'ghost'}`} onClick={() => setTab('Reports')}>
            Reports
          </button>
          <button className={`button ${tab === 'Export' ? 'primary' : 'ghost'}`} onClick={() => setTab('Export')}>
            Export
          </button>
        </div>
      </div>

      {tab === 'Reports' ? (
        <>
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
          <button
            className="button ghost"
            disabled={!['SystemAdministrator', 'SiteManager'].includes(currentUser.role)}
            onClick={async () => {
              const runSiteId = isGlobal ? selectedSite : (currentUser.siteId as number);
              await qualityService.runReport(runSiteId, currentUser);
            }}
          >
            Run Report Now
          </button>

          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Site</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {(reports ?? []).map((report) => (
                <Fragment key={report.id}>
                  <tr
                    onClick={() => {
                      setExpandedId((prev) => (prev === report.id ? null : (report.id as number)));
                      setSelectedId(report.id as number);
                    }}
                  >
                    <td>{new Date(report.generatedAt).toLocaleString()}</td>
                    <td>{report.siteId}</td>
                    <td>{report.type}</td>
                  </tr>
                  {expandedId === report.id ? (
                    <tr>
                      <td colSpan={3}>
                        <ReportDetail report={report} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      {tab === 'Export' ? (
        <div className="create-user-form">
          <select value={selectedId ?? ''} onChange={(event) => setSelectedId(Number(event.target.value))}>
            <option value="">Select report</option>
            {(reports ?? []).map((report) => (
              <option key={report.id} value={report.id}>
                {new Date(report.generatedAt).toLocaleString()} - site {report.siteId}
              </option>
            ))}
          </select>
          <button
            className="button primary"
            disabled={!selected}
            onClick={() => {
              if (selected) {
                qualityService.exportReportCsv(selected);
              }
            }}
          >
            Export as CSV
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ReportDetail({ report }: { report: QualityReport }) {
  const detail = JSON.parse(report.detail) as {
    stats: Array<{
      table: string;
      completenessPct: number;
      totalRows: number;
      missingFieldRows: number;
      duplicateRows: number;
    }>;
  };

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Table</th>
          <th>Completeness %</th>
          <th>Total</th>
          <th>Missing</th>
          <th>Duplicates</th>
        </tr>
      </thead>
      <tbody>
        {detail.stats.map((row) => (
          <tr key={row.table}>
            <td>{row.table}</td>
            <td>{row.completenessPct}</td>
            <td>{row.totalRows}</td>
            <td>{row.missingFieldRows}</td>
            <td>{row.duplicateRows}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
