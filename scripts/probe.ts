#!/usr/bin/env tsx
/**
 * Phase-1 self-verification CLI. Calls operations directly against the
 * live API and prints results. Intended for manual smoke testing.
 *
 * Usage:
 *   tsx scripts/probe.ts count
 *   tsx scripts/probe.ts list [limit]
 *   tsx scripts/probe.ts get <diveId>
 *   tsx scripts/probe.ts search <name>
 */
import { loadSession } from '../src/session.js';
import { listDives } from '../src/operations/list-dives.js';
import { getDive } from '../src/operations/get-dive.js';
import { countDives } from '../src/operations/count-dives.js';
import { searchDiveSites } from '../src/operations/search-dive-sites.js';

async function main(): Promise<void> {
  await loadSession();
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'count': {
      const c = await countDives();
      console.log(JSON.stringify({ count: c }, null, 2));
      return;
    }
    case 'list': {
      const limit = rest[0] ? Number(rest[0]) : 5;
      const items = await listDives({ limit });
      console.log(JSON.stringify(items, null, 2));
      return;
    }
    case 'get': {
      const id = Number(rest[0]);
      if (!Number.isFinite(id)) throw new Error('usage: probe get <diveId>');
      const dive = await getDive(id);
      console.log(JSON.stringify(dive, null, 2));
      return;
    }
    case 'search': {
      const q = rest.join(' ');
      if (!q) throw new Error('usage: probe search <name>');
      const sites = await searchDiveSites(q);
      console.log(JSON.stringify(sites, null, 2));
      return;
    }
    default:
      console.error('Commands: count | list [limit] | get <id> | search <name>');
      process.exit(2);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
