#!/usr/bin/env tsx
/**
 * Targeted follow-up enum probe for fields where the first sweep left
 * gaps. Same shape as scripts/enum-probe.ts but a different candidate set.
 *
 * Also probes the shape of `additional_equipment` (string? array? json?).
 */
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DiveInput } from '@padi-mcp/core';
import { GraphQLError, createDive, deleteDive, getDive, graphql, updateDive } from '../src/padi.js';
import { getSession, loadSession } from '../src/session.js';

type Field = 'dive_type' | 'status' | 'suit_type' | 'gas_mixture' | 'surge' | 'current';

const EXTRA: Record<Field, string[]> = {
  dive_type: ['ShoreDive', 'Beach', 'Pool', 'Cave', 'Ice', 'Night', 'Drift', 'Wreck'],
  status: ['Pending', 'Hidden', 'Private', 'Public', 'Active', 'Inactive', 'Archive'],
  suit_type: [
    'Wetsuit',
    'Wet',
    'Dry',
    'Full',
    'FullSuit',
    'Skin',
    'DiveSkin',
    'Bare',
    'Drysuit',
    'BoardShorts',
    'Swimsuit',
  ],
  gas_mixture: ['Nitrox', 'EAN', 'EANx', 'Heliox', 'O2', 'Oxygen', 'Argon'],
  surge: ['LowSurge', 'HighSurge', 'BigSurge'],
  current: ['LowCurrent', 'HighCurrent', 'BigCurrent'],
};

type FieldGroup = 'general' | 'conditions' | 'equipment';
const FIELD_GROUPS: Record<Field, FieldGroup> = {
  dive_type: 'general',
  status: 'general',
  surge: 'conditions',
  current: 'conditions',
  suit_type: 'equipment',
  gas_mixture: 'equipment',
};

const SANDBOX_TITLE = `MCPTEST_${randomUUID()}`;
const SANDBOX: DiveInput = {
  dive_title: SANDBOX_TITLE,
  dive_date: '1900-01-01',
  dive_location: 'Enum Probe Extra',
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
  weather: 'Sunny',
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
  notes: 'mcp-test-do-not-display\nenum probe extra',
  buddies: 'Alone',
  dive_center: 'MCP Test Center',
};

interface Result {
  field: string;
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
  const sub = (dive as unknown as Record<string, Record<string, string | null> | null>)[group];
  return sub?.[field] ?? null;
}

/**
 * additional_equipment shape probe. The brief said it's a string. Try
 * string, JSON-stringified array, comma-list, and a raw GraphQL array.
 * Also try update via raw GraphQL with an array literal.
 */
async function probeAdditionalEquipment(diveId: number, results: Result[]): Promise<void> {
  const candidates: Array<{ label: string; value: unknown }> = [
    { label: 'plain string', value: 'Camera' },
    { label: 'comma list', value: 'Camera, Light' },
    { label: 'JSON array', value: '["Camera","Light"]' },
    { label: 'newline list', value: 'Camera\nLight' },
  ];
  for (const c of candidates) {
    try {
      await updateDive({ diveId, additional_equipment: c.value as string });
      const after = await getDive(diveId);
      const read = after?.equipment?.additional_equipment ?? null;
      const matches = JSON.stringify(read) === JSON.stringify(c.value);
      results.push({
        field: 'additional_equipment',
        value: `${c.label}: ${JSON.stringify(c.value)}`,
        outcome: matches ? 'accepted' : 'normalised',
        read: JSON.stringify(read),
      });
      console.error(
        `${matches ? '✅' : '🔁'} additional_equipment[${c.label}] → ${JSON.stringify(read)}`,
      );
    } catch (e) {
      if (e instanceof GraphQLError) {
        results.push({
          field: 'additional_equipment',
          value: `${c.label}: ${JSON.stringify(c.value)}`,
          outcome: 'rejected',
          error: JSON.stringify(e.errors),
        });
        console.error(
          `❌ additional_equipment[${c.label}]: ${JSON.stringify(e.errors).slice(0, 200)}`,
        );
      } else throw e;
    }
  }

  // Schema introspection on the equipment table column type via a typed
  // GraphQL error.
  try {
    const { affiliate_id } = getSession();
    const q = `query Introspect($aid: Int!, $id: Int!) {
      logbook_equipment(where: {logs_id: {_eq: $id}}) {
        additional_equipment
      }
    }`;
    const data = await graphql<{ logbook_equipment: Array<{ additional_equipment: unknown }> }>({
      operationName: 'Introspect',
      query: q,
      variables: { aid: Number(affiliate_id), id: diveId },
    });
    const raw = data.logbook_equipment[0]?.additional_equipment ?? null;
    console.error(
      `additional_equipment raw shape: typeof=${typeof raw} value=${JSON.stringify(raw)}`,
    );
    results.push({
      field: 'additional_equipment_raw_shape',
      value: `typeof=${typeof raw}`,
      outcome: 'accepted',
      read: JSON.stringify(raw),
    });
  } catch (e) {
    console.error('introspection failed', e);
  }
}

async function main(): Promise<void> {
  await loadSession();
  console.error(`enum-probe-extra: creating sandbox dive "${SANDBOX_TITLE}"`);
  const diveId = await createDive(SANDBOX);
  console.error(`enum-probe-extra: id=${diveId}`);

  const results: Result[] = [];
  try {
    for (const [fieldKey, values] of Object.entries(EXTRA) as [Field, string[]][]) {
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
            console.error(`❌ ${fieldKey}=${value}: ${msg.slice(0, 160)}`);
          } else {
            throw e;
          }
        }
      }
    }

    await probeAdditionalEquipment(diveId, results);
  } finally {
    console.error('enum-probe-extra: cleaning up');
    try {
      await deleteDive(diveId);
    } catch (e) {
      console.error(`enum-probe-extra: cleanup failed, manual deletion required for ${diveId}`);
      console.error(e);
    }
  }

  const lines = [
    '',
    `## Extra probe run ${new Date().toISOString()}`,
    '',
    '| Field | Value | Outcome | Notes |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const outcome =
      r.outcome === 'accepted'
        ? '✅'
        : r.outcome === 'normalised'
          ? `🔁 → ${JSON.stringify(r.read)}`
          : '❌';
    const notes = r.error ? r.error.slice(0, 140) : '';
    lines.push(`| ${r.field} | ${r.value} | ${outcome} | ${notes} |`);
  }
  await appendFile(resolve(process.cwd(), 'docs/enums.md'), `${lines.join('\n')}\n`, 'utf8');
  console.error(`enum-probe-extra: appended ${results.length} results to docs/enums.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
