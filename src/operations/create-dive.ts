/**
 * Create a new dive. Uses the exact captured mutation shape — `general` is
 * passed as a single object even though the GraphQL variable is declared
 * `[logbook_logs_insert_input!]!`; Hasura wraps it.
 *
 * The captured payload (samples/insert_logbook_logs.json) uses string-valued
 * numerics; we mirror that on insert.
 */
import { graphql } from '../padi-client.js';
import { getSession } from '../session.js';
import { coerceAdditionalEquipmentWrite } from '../transforms/arrays.js';
import { isoToUsDate, nowNaiveTimestamp } from '../transforms/dates.js';
import { toNumericString } from '../transforms/numbers.js';
import type { DiveInput } from '../types.js';

const MUTATION = `mutation insert_logbook_logs($general: [logbook_logs_insert_input!]!) {
  insert_logbook_logs(objects: $general) {
    affected_rows
    returning {
      id
      affiliate_id
      dive_title
      dive_type
      dive_location
      log_type
      log_course
      dive_date
      created_date
      status
      adventure_dive
    }
  }
}`;

interface InsertResult {
  affected_rows: number;
  returning: Array<{
    id: number;
    affiliate_id: number | string;
    dive_title: string | null;
    dive_type: string | null;
    dive_location: string | null;
    log_type: string | null;
    log_course: string | null;
    dive_date: string | null;
    created_date: string | null;
    status: string | null;
    adventure_dive: string | null;
  }>;
}

/**
 * Build the nested-insert `general` object exactly the way the captured
 * payload does. Anything optional that's `undefined` is omitted; anything
 * `null` is sent as null (matches the wire convention).
 */
export function buildInsertGeneral(input: DiveInput): Record<string, unknown> {
  const { affiliate_id } = getSession();
  const ts = nowNaiveTimestamp();
  return {
    affiliate_id,
    log_type: input.log_type,
    log_course: input.log_course ?? null,
    log_number: input.log_number ?? null,
    created_date: ts,
    update_date: ts,
    dive_type: input.dive_type ?? null,
    dive_title: input.dive_title,
    dive_location: input.dive_location ?? null,
    dive_date: isoToUsDate(input.dive_date),
    status: input.status,
    memsys_member_number: input.memsys_member_number ?? undefined,
    adventure_dive: input.adventure_dive ?? undefined,
    depth_times: {
      data: {
        bottom_time: toNumericString(input.bottom_time),
        max_depth: toNumericString(input.max_depth),
        ...(input.time_in !== undefined && { time_in: input.time_in }),
        ...(input.time_out !== undefined && { time_out: input.time_out }),
      },
    },
    conditions: {
      data: {
        water_type: input.water_type ?? null,
        body_of_water: input.body_of_water ?? null,
        weather: input.weather ?? null,
        air_temp: toNumericString(input.air_temp),
        surface_water_temp: toNumericString(input.surface_water_temp),
        bottom_water_temp: toNumericString(input.bottom_water_temp),
        visibility: input.visibility ?? null,
        visibility_distance: toNumericString(input.visibility_distance),
        wave_condition: input.wave_condition ?? null,
        current: input.current ?? null,
        surge: input.surge ?? null,
      },
    },
    equipment: {
      data: {
        starting_pressure: toNumericString(input.starting_pressure),
        ending_pressure: toNumericString(input.ending_pressure),
        suit_type: input.suit_type ?? null,
        weight: toNumericString(input.weight),
        weight_type: input.weight_type ?? null,
        additional_equipment: coerceAdditionalEquipmentWrite(input.additional_equipment),
        cylinder_type: input.cylinder_type ?? null,
        cylinder_size: toNumericString(input.cylinder_size),
        gas_mixture: input.gas_mixture ?? null,
        oxygen: toNumericString(input.oxygen),
        nitrogen: toNumericString(input.nitrogen),
        helium: toNumericString(input.helium),
      },
    },
    experiences: {
      data: {
        feeling: input.feeling ?? null,
        notes: input.notes ?? null,
        buddies: input.buddies ?? null,
        dive_center: input.dive_center ?? null,
      },
    },
  };
}

export async function createDive(input: DiveInput): Promise<number> {
  const general = buildInsertGeneral(input);
  const data = await graphql<{ insert_logbook_logs: InsertResult }>({
    operationName: 'insert_logbook_logs',
    query: MUTATION,
    variables: { general },
  });
  const ret = data.insert_logbook_logs.returning[0];
  if (!ret) throw new Error('insert_logbook_logs returned no rows');
  return ret.id;
}
