#!/usr/bin/env tsx
/**
 * Third-pass enum probe driven by values extracted from
 * inputs/moreoptions{1,2}.har. The first two probe runs missed the
 * underscore naming convention (FullSuit_3mm vs FullSuit3mm,
 * Enriched_32 vs Nitrox32, etc.). Re-runs those literals plus tests
 * whether Enriched_* requires the oxygen percentage to be set
 * (the user's hint: "for some suit types it's mandatory to provide the
 * oxygen mix" — almost certainly meant gas mixtures).
 */
import { randomUUID } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DiveInput } from '@padi-mcp/core';
import { GraphQLError, createDive, deleteDive, getDive, updateDive } from '../src/padi.js';
import { loadSession } from '../src/session.js';

const FROM_HAR: Record<string, string[]> = {
  dive_type: ['BeachShore'],
  suit_type: ['NoExposure', 'FullSuit_3mm', 'FullSuit_5mm', 'FullSuit_7mm', 'SemiDrySuit'],
  gas_mixture: ['Enriched_32', 'Enriched_36', 'Enriched_40'],
};

const SANDBOX_TITLE = `MCPTEST_${randomUUID()}`;
const SANDBOX: DiveInput = {
  dive_title: SANDBOX_TITLE,
  dive_date: '1900-01-01',
  dive_location: 'HAR Probe',
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
  notes: 'mcp-test har-driven probe',
  buddies: null,
  dive_center: null,
};

type FieldGroup = 'general' | 'equipment';
const GROUP: Record<string, FieldGroup> = {
  dive_type: 'general',
  suit_type: 'equipment',
  gas_mixture: 'equipment',
};

interface Result {
  field: string;
  value: string;
  outcome: 'accepted' | 'normalised' | 'rejected';
  read?: string | null;
  error?: string;
}

function readField(field: string, dive: Awaited<ReturnType<typeof getDive>>): string | null {
  if (!dive) return null;
  if (GROUP[field] === 'general') {
    return (dive as unknown as Record<string, string | null>)[field] ?? null;
  }
  const eq = dive.equipment;
  if (!eq) return null;
  return (eq as unknown as Record<string, string | null>)[field] ?? null;
}

async function probeOxygenRequirement(diveId: number, results: Result[]): Promise<void> {
  // Does setting gas_mixture: Enriched_32 require oxygen to be set?
  // Try: gas_mixture only (no oxygen change), then with oxygen=32.
  console.error('--- gas_mixture/oxygen interaction ---');
  try {
    // Reset oxygen to null first by updating to a known state
    await updateDive({ diveId, gas_mixture: 'Air', oxygen: 21, nitrogen: 79 });
    // Now try Enriched_32 without changing oxygen (currently 21)
    try {
      await updateDive({ diveId, gas_mixture: 'Enriched_32' });
      const after = await getDive(diveId);
      const gm = after?.equipment?.gas_mixture;
      const o2 = after?.equipment?.oxygen;
      console.error(`Enriched_32 (oxygen stays 21): gas=${gm}, oxygen=${o2}`);
      results.push({
        field: 'gas_mixture/oxygen',
        value: 'Enriched_32 with oxygen=21 (no change)',
        outcome: 'accepted',
        read: `gas=${gm}, oxygen=${o2}`,
      });
    } catch (e) {
      if (e instanceof GraphQLError) {
        console.error(`❌ Enriched_32 alone rejected: ${JSON.stringify(e.errors).slice(0, 250)}`);
        results.push({
          field: 'gas_mixture/oxygen',
          value: 'Enriched_32 alone (oxygen unchanged)',
          outcome: 'rejected',
          error: JSON.stringify(e.errors),
        });
      } else throw e;
    }

    // Try Enriched_32 with matching oxygen=32
    await updateDive({ diveId, gas_mixture: 'Enriched_32', oxygen: 32, nitrogen: 68 });
    const after2 = await getDive(diveId);
    console.error(
      `Enriched_32 + oxygen=32: gas=${after2?.equipment?.gas_mixture}, oxygen=${after2?.equipment?.oxygen}`,
    );
    results.push({
      field: 'gas_mixture/oxygen',
      value: 'Enriched_32 + oxygen=32 + nitrogen=68',
      outcome: 'accepted',
      read: `gas=${after2?.equipment?.gas_mixture}, oxygen=${after2?.equipment?.oxygen}`,
    });

    // Mismatch test: Enriched_36 + oxygen=21
    try {
      await updateDive({ diveId, gas_mixture: 'Enriched_36', oxygen: 21, nitrogen: 79 });
      const after3 = await getDive(diveId);
      console.error(
        `Enriched_36 + oxygen=21 (mismatch): gas=${after3?.equipment?.gas_mixture}, oxygen=${after3?.equipment?.oxygen}`,
      );
      results.push({
        field: 'gas_mixture/oxygen',
        value: 'Enriched_36 + oxygen=21 (intentional mismatch)',
        outcome: 'accepted',
        read: `gas=${after3?.equipment?.gas_mixture}, oxygen=${after3?.equipment?.oxygen}`,
      });
    } catch (e) {
      if (e instanceof GraphQLError) {
        console.error(
          `❌ Enriched_36 + oxygen=21 rejected: ${JSON.stringify(e.errors).slice(0, 250)}`,
        );
        results.push({
          field: 'gas_mixture/oxygen',
          value: 'Enriched_36 + oxygen=21 (mismatch)',
          outcome: 'rejected',
          error: JSON.stringify(e.errors),
        });
      } else throw e;
    }
  } catch (e) {
    console.error('oxygen-requirement probe failed', e);
  }
}

async function main(): Promise<void> {
  await loadSession();
  console.error(`probe: creating sandbox dive "${SANDBOX_TITLE}"`);
  const diveId = await createDive(SANDBOX);
  console.error(`probe: id=${diveId}`);

  const results: Result[] = [];
  try {
    for (const [field, values] of Object.entries(FROM_HAR)) {
      for (const value of values) {
        try {
          await updateDive({ diveId, [field]: value });
          const after = await getDive(diveId);
          const read = readField(field, after);
          if (read === value) {
            results.push({ field, value, outcome: 'accepted', read });
            console.error(`✅ ${field}=${value}`);
          } else {
            results.push({ field, value, outcome: 'normalised', read });
            console.error(`🔁 ${field}=${value} → ${read}`);
          }
        } catch (e) {
          if (e instanceof GraphQLError) {
            const msg = JSON.stringify(e.errors);
            results.push({ field, value, outcome: 'rejected', error: msg });
            console.error(`❌ ${field}=${value}: ${msg.slice(0, 200)}`);
          } else throw e;
        }
      }
    }

    await probeOxygenRequirement(diveId, results);
  } finally {
    console.error('probe: cleaning up');
    try {
      await deleteDive(diveId);
    } catch (e) {
      console.error(`probe: cleanup failed, manual deletion required for ${diveId}`);
      console.error(e);
    }
  }

  const lines = [
    '',
    `## HAR-driven probe run ${new Date().toISOString()}`,
    '',
    '| Field | Value | Outcome | Notes |',
    '|---|---|---|---|',
  ];
  for (const r of results) {
    const outcome =
      r.outcome === 'accepted' ? '✅' : r.outcome === 'normalised' ? `🔁 → ${r.read}` : '❌';
    const notes = r.error ? r.error.slice(0, 160) : (r.read ?? '');
    lines.push(`| ${r.field} | ${r.value} | ${outcome} | ${notes} |`);
  }
  await appendFile(resolve(process.cwd(), 'docs/enums.md'), `${lines.join('\n')}\n`, 'utf8');
  console.error(`probe: appended ${results.length} results to docs/enums.md`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
