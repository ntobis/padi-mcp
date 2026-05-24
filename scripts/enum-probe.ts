#!/usr/bin/env tsx
/**
 * Phase-4 enum probing. Creates a single sandbox dive, then for each
 * candidate (field, value) attempts an update and reads back. Records:
 *   ✅ accepted  — written value === read value
 *   🔁 normalised — accepted but server returned a different value
 *   ❌ rejected  — GraphQL error (message captured)
 *
 * Results are appended to docs/enums.md and printed.
 */
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadSession } from '../src/session.js';
import { createDive } from '../src/operations/create-dive.js';
import { getDive } from '../src/operations/get-dive.js';
import { updateDive } from '../src/operations/update-dive.js';
import { deleteDive } from '../src/operations/delete-dive.js';
import { GraphQLError } from '../src/padi-client.js';
import type { DiveInput } from '../src/types.js';

type Field =
  | 'log_type'
  | 'dive_type'
  | 'status'
  | 'water_type'
  | 'body_of_water'
  | 'weather'
  | 'visibility'
  | 'wave_condition'
  | 'current'
  | 'surge'
  | 'suit_type'
  | 'weight_type'
  | 'cylinder_type'
  | 'gas_mixture'
  | 'feeling';

const CANDIDATES: Record<Field, string[]> = {
  log_type: ['Recreational', 'Training'],
  dive_type: ['Boat', 'Shore', 'Other'],
  status: ['Publish', 'Draft', 'Trash', 'Deleted', 'Archived'],
  water_type: ['Salt', 'Fresh'],
  body_of_water: ['Ocean', 'Lake', 'Quarry', 'River', 'Other'],
  weather: ['Sunny', 'Partly Cloudy', 'Cloudy', 'Rainy', 'Windy', 'Foggy'],
  visibility: ['High', 'Average', 'Low'],
  wave_condition: ['NoWaves', 'SmallWaves', 'MediumWaves', 'LargeWaves'],
  current: ['NoCurrent', 'LightCurrent', 'SomeCurrent', 'MediumCurrent', 'StrongCurrent'],
  surge: ['NoSurge', 'LightSurge', 'SomeSurge', 'MediumSurge', 'StrongSurge'],
  suit_type: ['None', 'Shorty', 'FullSuit3mm', 'FullSuit5mm', 'FullSuit7mm', 'SemiDry', 'DrySuit'],
  weight_type: ['Light', 'Good', 'Heavy'],
  cylinder_type: ['Aluminum', 'Steel', 'Other'],
  gas_mixture: ['Air', 'Nitrox32', 'Nitrox36', 'Nitrox40', 'Enriched', 'Trimix', 'Rebreather'],
  feeling: ['Amazing', 'Good', 'Average', 'Poor'],
};

const SANDBOX_TITLE = `MCPTEST_${randomUUID()}`;
const SANDBOX: DiveInput = {
  dive_title: SANDBOX_TITLE,
  dive_date: '1900-01-01',
  dive_location: 'Enum Probe',
  dive_type: 'Boat',
  log_type: 'Recreational',
  log_course: null,
  log_number: null,
  status: 'Publish',
  adventure_dive: null,
  memsys_member_number: null,
  max_depth: 10,
  bottom_time: 30,
  water_type: 'Salt',
  body_of_water: 'Ocean',
  weather: 'Partly Cloudy',
  air_temp: 25,
  surface_water_temp: 25,
  bottom_water_temp: 20,
  visibility: 'Average',
  visibility_distance: 10,
  wave_condition: 'SmallWaves',
  current: 'SomeCurrent',
  surge: 'SomeSurge',
  suit_type: 'Shorty',
  weight: 2,
  weight_type: 'Good',
  additional_equipment: null,
  cylinder_type: 'Aluminum',
  cylinder_size: 10,
  gas_mixture: 'Air',
  oxygen: 21,
  nitrogen: 79,
  helium: 0,
  starting_pressure: 200,
  ending_pressure: 50,
  feeling: 'Good',
  notes: 'mcp-test-do-not-display\nenum probe',
  buddies: 'Alone',
  dive_center: 'MCP Test Center',
};

type FieldGroup = 'general' | 'depthTime' | 'conditions' | 'equipment' | 'experience';
const FIELD_GROUPS: Record<Field, FieldGroup> = {
  log_type: 'general',
  dive_type: 'general',
  status: 'general',
  water_type: 'conditions',
  body_of_water: 'conditions',
  weather: 'conditions',
  visibility: 'conditions',
  wave_condition: 'conditions',
  current: 'conditions',
  surge: 'conditions',
  suit_type: 'equipment',
  weight_type: 'equipment',
  cylinder_type: 'equipment',
  gas_mixture: 'equipment',
  feeling: 'experience',
};

interface Result {
  field: Field;
  value: string;
  outcome: 'accepted' | 'normalised' | 'rejected';
  read?: string | null;
  error?: string;
}

function readField(field: Field, dive: Awaited<ReturnType<typeof getDive>>): string | null {
  if (!dive) return null;
  const group = FIELD_GROUPS[field];
  if (group === 'general') {
    return (dive as unknown as Record<string, string | null>)[field] ?? null;
  }
  const sub = (dive as unknown as Record<string, Record<string, string | null> | null>)[
    group === 'depthTime'
      ? 'depth_time'
      : group === 'experience'
        ? 'experience'
        : group
  ];
  return sub?.[field] ?? null;
}

async function main(): Promise<void> {
  await loadSession();
  console.error(`enum-probe: creating sandbox dive "${SANDBOX_TITLE}"`);
  const diveId = await createDive(SANDBOX);
  console.error(`enum-probe: id=${diveId}`);

  const results: Result[] = [];
  try {
    for (const [fieldKey, values] of Object.entries(CANDIDATES) as [Field, string[]][]) {
      for (const value of values) {
        try {
          await updateDive({ diveId, [fieldKey]: value });
          const after = await getDive(diveId);
          const read = readField(fieldKey, after);
          if (read === value) {
            results.push({ field: fieldKey, value, outcome: 'accepted', read });
            console.error(`✅ ${fieldKey}=${value}`);
          } else {
            results.push({ field: fieldKey, value, outcome: 'normalised', read });
            console.error(`🔁 ${fieldKey}=${value} → ${read}`);
          }
        } catch (e) {
          if (e instanceof GraphQLError) {
            const msg = JSON.stringify(e.errors);
            results.push({ field: fieldKey, value, outcome: 'rejected', error: msg });
            console.error(`❌ ${fieldKey}=${value}: ${msg.slice(0, 200)}`);
          } else {
            throw e;
          }
        }
      }
    }
  } finally {
    console.error('enum-probe: cleaning up');
    try {
      await deleteDive(diveId);
    } catch (e) {
      console.error(`enum-probe: cleanup failed, manual deletion required for ${diveId}`);
      console.error(e);
    }
  }

  // Append a results section to docs/enums.md
  const lines = ['', `## Probe run ${new Date().toISOString()}`, '', '| Field | Value | Outcome | Notes |', '|---|---|---|---|'];
  for (const r of results) {
    const outcome =
      r.outcome === 'accepted' ? '✅' : r.outcome === 'normalised' ? `🔁 → ${r.read}` : '❌';
    const notes = r.error ? r.error.slice(0, 120) : '';
    lines.push(`| ${r.field} | ${r.value} | ${outcome} | ${notes} |`);
  }
  await appendFile(resolve(process.cwd(), 'docs/enums.md'), `${lines.join('\n')}\n`, 'utf8');
  console.error(`enum-probe: appended ${results.length} results to docs/enums.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
