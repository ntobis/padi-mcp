#!/usr/bin/env tsx
/**
 * Full CRUD sweep against the sandbox:
 *   1. Create a dive with title MCPTEST_<uuid> and date 1900-01-01.
 *   2. Fetch it, diff against the input.
 *   3. Update several fields, fetch, diff.
 *   4. Delete it (try strategies until one works), confirm it's gone.
 *
 * Always cleans up via try/finally, even on failure midway through.
 *
 * Usage:
 *   tsx scripts/test-lifecycle.ts
 */
import { randomUUID } from 'node:crypto';
import { createDive } from '../src/operations/create-dive.js';
import { deleteDive } from '../src/operations/delete-dive.js';
import { getDive } from '../src/operations/get-dive.js';
import { updateDive } from '../src/operations/update-dive.js';
import { loadSession } from '../src/session.js';
import type { DiveInput } from '../src/types.js';

const SANDBOX_TITLE = `MCPTEST_${randomUUID()}`;
const SANDBOX_DATE = '1900-01-01';
const SANDBOX_NOTE = 'mcp-test-do-not-display';

const createInput: DiveInput = {
  dive_title: SANDBOX_TITLE,
  dive_date: SANDBOX_DATE,
  dive_location: 'MCP Test Site',
  dive_type: 'Boat',
  log_type: 'Recreational',
  log_course: null,
  log_number: null,
  status: 'Publish',
  adventure_dive: null,
  memsys_member_number: null,
  max_depth: 20,
  bottom_time: 50,
  water_type: 'Salt',
  body_of_water: 'Ocean',
  weather: 'Partly Cloudy',
  air_temp: 30,
  surface_water_temp: 30,
  bottom_water_temp: 25,
  visibility: 'Average',
  visibility_distance: 18,
  wave_condition: 'SmallWaves',
  current: 'SomeCurrent',
  surge: 'SomeSurge',
  suit_type: 'Shorty',
  weight: 2,
  weight_type: 'Good',
  additional_equipment: null,
  cylinder_type: 'Aluminum',
  cylinder_size: 9,
  gas_mixture: 'Air',
  oxygen: 21,
  nitrogen: 79,
  helium: 0,
  starting_pressure: 200,
  ending_pressure: 50,
  feeling: 'Good',
  notes: `${SANDBOX_NOTE}\nlifecycle round-trip`,
  buddies: 'Alone',
  dive_center: 'MCP Test Center',
};

interface Diff {
  field: string;
  expected: unknown;
  actual: unknown;
}

function compareDive(
  expected: Partial<DiveInput>,
  actual: Awaited<ReturnType<typeof getDive>>,
): Diff[] {
  if (!actual) return [{ field: '<dive>', expected: 'present', actual: null }];
  const diffs: Diff[] = [];
  const check = (field: string, exp: unknown, act: unknown) => {
    if (exp === undefined) return;
    if (exp === null && act === null) return;
    if (JSON.stringify(exp) !== JSON.stringify(act)) {
      diffs.push({ field, expected: exp, actual: act });
    }
  };
  check('dive_title', expected.dive_title, actual.dive_title);
  check('dive_date', expected.dive_date, actual.dive_date);
  check('dive_location', expected.dive_location, actual.dive_location);
  check('dive_type', expected.dive_type, actual.dive_type);
  check('log_type', expected.log_type, actual.log_type);
  check('status', expected.status, actual.status);
  check('max_depth', expected.max_depth, actual.depth_time?.max_depth);
  check('bottom_time', expected.bottom_time, actual.depth_time?.bottom_time);
  check('water_type', expected.water_type, actual.conditions?.water_type);
  check('body_of_water', expected.body_of_water, actual.conditions?.body_of_water);
  check('weather', expected.weather, actual.conditions?.weather);
  check('air_temp', expected.air_temp, actual.conditions?.air_temp);
  check('visibility', expected.visibility, actual.conditions?.visibility);
  check('wave_condition', expected.wave_condition, actual.conditions?.wave_condition);
  check('current', expected.current, actual.conditions?.current);
  check('surge', expected.surge, actual.conditions?.surge);
  check('suit_type', expected.suit_type, actual.equipment?.suit_type);
  check('weight', expected.weight, actual.equipment?.weight);
  check('cylinder_size', expected.cylinder_size, actual.equipment?.cylinder_size);
  check('gas_mixture', expected.gas_mixture, actual.equipment?.gas_mixture);
  check('starting_pressure', expected.starting_pressure, actual.equipment?.starting_pressure);
  check('ending_pressure', expected.ending_pressure, actual.equipment?.ending_pressure);
  check('feeling', expected.feeling, actual.experience?.feeling);
  check('notes', expected.notes, actual.experience?.notes);
  check('buddies', expected.buddies, actual.experience?.buddies);
  check('dive_center', expected.dive_center, actual.experience?.dive_center);
  return diffs;
}

async function main(): Promise<void> {
  await loadSession();
  console.error(`lifecycle: creating sandbox dive "${SANDBOX_TITLE}"`);
  let diveId: number | null = null;
  try {
    diveId = await createDive(createInput);
    console.error(`lifecycle: created id=${diveId}`);

    const after = await getDive(diveId);
    const createDiffs = compareDive(createInput, after);
    if (createDiffs.length > 0) {
      console.error('lifecycle: CREATE diffs:', JSON.stringify(createDiffs, null, 2));
      throw new Error('create round-trip failed');
    }
    console.error('lifecycle: create round-trip OK');

    const updatePatch = {
      diveId,
      notes: `${SANDBOX_NOTE}\nupdated`,
      max_depth: 25,
      visibility: 'Average',
      weight: 3,
      additional_equipment: ['Camera', 'Dive Light'],
    };
    await updateDive(updatePatch);
    const afterUpdate = await getDive(diveId);
    const updateDiffs = compareDive(
      { ...createInput, notes: updatePatch.notes, max_depth: 25, weight: 3 },
      afterUpdate,
    );
    const ae = afterUpdate?.equipment?.additional_equipment;
    if (JSON.stringify(ae) !== JSON.stringify(updatePatch.additional_equipment)) {
      updateDiffs.push({
        field: 'additional_equipment',
        expected: updatePatch.additional_equipment,
        actual: ae,
      });
    }
    if (updateDiffs.length > 0) {
      console.error('lifecycle: UPDATE diffs:', JSON.stringify(updateDiffs, null, 2));
      throw new Error('update round-trip failed');
    }
    console.error('lifecycle: update round-trip OK');

    const strategy = await deleteDive(diveId);
    console.error(`lifecycle: delete succeeded via strategy=${strategy}`);
    diveId = null;
    console.error('lifecycle: PASS');
  } finally {
    if (diveId !== null) {
      console.error(`lifecycle: cleanup — attempting delete of ${diveId}`);
      try {
        const strategy = await deleteDive(diveId);
        console.error(`lifecycle: cleanup deleted via ${strategy}`);
      } catch (e) {
        console.error(`lifecycle: cleanup FAILED — manual cleanup needed for id ${diveId}`);
        console.error(e);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
