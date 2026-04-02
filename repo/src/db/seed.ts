import { db } from './db';
import type { Bay, Site, User, UserRole } from '../types';
import { cryptoService } from '../services/cryptoService';

// Pre-computed PBKDF2 hashes for demo seed users.
// This avoids running 4 x 100K-iteration hashes on every first page load,
// cutting initial bootstrap from ~3 seconds to near-instant.
// The passwords remain as listed in the README for manual login.
const DEMO_USERS: Array<{
  username: string;
  password: string;
  role: UserRole;
  siteId?: number;
  preHash: string;
  preSalt: string;
}> = [
  {
    username: 'sysadmin',
    password: 'ChargeBay#Admin1',
    role: 'SystemAdministrator',
    preHash: '749124ce56acc1eff94fb28959a169bae683e297e493f2532b17b20ab1863337',
    preSalt: '9416892b1108e0b53484858a6797965f'
  },
  {
    username: 'manager',
    password: 'ChargeBay#Mgr01',
    role: 'SiteManager',
    siteId: 1,
    preHash: '75b68ebebcf9b6f949712e178d8b4434039672c37c15e9613f7b43acae628f12',
    preSalt: 'b05219321a29dec84e347746eb67065c'
  },
  {
    username: 'attendant',
    password: 'ChargeBay#Att01',
    role: 'Attendant',
    siteId: 1,
    preHash: 'd786870797c95f2fee97c65e86a8312bef7fd118c6ee61b35076580e28fc1590',
    preSalt: 'e9936aef114ad1be51356bc8af5a43c5'
  },
  {
    username: 'auditor',
    password: 'ChargeBay#Aud01',
    role: 'Auditor',
    siteId: 1,
    preHash: '6721aad92647ff3b03a8d45ee7f6ee5d4793a51c5dc6f360f5dd0d060b1806a9',
    preSalt: '8181d4c96f523e368d6fe06fc9f35d50'
  }
];

async function seedUsers() {
  const users: User[] = DEMO_USERS.map((u) => ({
    username: u.username,
    passwordHash: u.preHash,
    salt: u.preSalt,
    role: u.role,
    siteId: u.siteId,
    failedAttempts: 0
  }));

  await db.users.bulkAdd(users);
}

async function seedSiteAndBays() {
  const site: Site = { siteCode: 'SITE-001', name: 'ChargeBay Site 1' };
  const siteId = await db.sites.add(site);

  const bays: Bay[] = ['ST-01', 'ST-02', 'ST-03', 'ST-04'].map((stationId, index) => ({
    siteId,
    stationId,
    connectorId: 'C1',
    label: `Bay ${index + 1}`,
    status: 'Available'
  }));

  await db.bays.bulkAdd(bays);
}

async function migrateLegacySeedUsers() {
  const users = await db.users.toArray();
  const demoPasswordByUsername = new Map(DEMO_USERS.map((entry) => [entry.username, entry.password]));

  // Do all crypto work first, outside any transaction
  const updates: Array<{ id: number; hash: string; salt: string }> = [];
  for (const user of users) {
    if (user.salt) {
      continue;
    }

    const password = demoPasswordByUsername.get(user.username);
    if (!password || !user.id) {
      continue;
    }

    const { hash, salt } = await cryptoService.hashPassword(password);
    updates.push({ id: user.id, hash, salt });
  }

  for (const update of updates) {
    await db.users.update(update.id, {
      passwordHash: update.hash,
      salt: update.salt,
      failedAttempts: 0,
      lockedUntil: undefined
    });
  }
}

export async function seedIfEmpty() {
  const userCount = await db.users.count();
  if (userCount > 0) {
    await migrateLegacySeedUsers();
    return;
  }

  await seedSiteAndBays();
  await seedUsers();
}
