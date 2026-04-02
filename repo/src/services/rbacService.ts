import type { User } from '../types';

export class ScopeViolationError extends Error {
  code = 'RBAC_SCOPE_VIOLATION' as const;

  constructor() {
    super('RBAC_SCOPE_VIOLATION');
    this.name = 'ScopeViolationError';
  }
}

export function assertSiteScope(actor: User, recordSiteId: number): void {
  if (actor.role !== 'SystemAdministrator' && actor.siteId !== recordSiteId) {
    throw new ScopeViolationError();
  }
}

export function assertCanMutate(actor: User): void {
  if (actor.role === 'Auditor') {
    throw new ScopeViolationError();
  }
}

export function assertManagerOrAdmin(actor: User): void {
  if (actor.role !== 'SystemAdministrator' && actor.role !== 'SiteManager') {
    throw new ScopeViolationError();
  }
}
