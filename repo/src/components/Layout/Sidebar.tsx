import { NavLink } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import type { UserRole } from '../../types';

interface NavItem {
  to: string;
  label: string;
  roles: UserRole[];
}

const NAV_ITEMS: NavItem[] = [
  { to: '/admin/dashboard', label: 'Dashboard', roles: ['SystemAdministrator', 'Auditor'] },
  { to: '/admin/reservations', label: 'Reservations', roles: ['SystemAdministrator'] },
  { to: '/admin/sessions', label: 'Sessions & Orders', roles: ['SystemAdministrator', 'Auditor'] },
  {
    to: '/admin/import',
    label: 'Bulk Import',
    roles: ['SystemAdministrator', 'SiteManager']
  },
  {
    to: '/admin/quality',
    label: 'Data Quality',
    roles: ['SystemAdministrator', 'Auditor', 'SiteManager']
  },
  { to: '/admin/audit', label: 'Audit Log', roles: ['SystemAdministrator', 'Auditor'] },
  { to: '/admin/config', label: 'Site Config', roles: ['SystemAdministrator', 'SiteManager'] },
  {
    to: '/admin/notifications',
    label: 'Notifications',
    roles: ['SystemAdministrator', 'SiteManager', 'Attendant', 'Auditor']
  },
  { to: '/admin/users', label: 'Users', roles: ['SystemAdministrator'] }
];

export default function Sidebar() {
  const { hasRole } = useAuth();
  const visibleItems = NAV_ITEMS.filter((item) => hasRole(...item.roles));

  return (
    <aside className="sidebar">
      <h2 className="sidebar-title">Admin Mode</h2>
      <div className="sidebar-links">
        {visibleItems.map((item) => (
          <NavLink key={item.to} to={item.to} className="sidebar-link">
            {item.label}
          </NavLink>
        ))}
      </div>
    </aside>
  );
}
