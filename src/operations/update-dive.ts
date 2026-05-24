/**
 * Update an existing dive. The captured mutation always sends `_set` for
 * all five tables, even when only one field changed; we mirror that.
 *
 * Numerics go as numbers (matches the captured UpdateRecreationalDiveLog
 * payload — e.g. `bottom_water_temp: 25`, `weight: 2`).
 */
import { graphql } from '../padi-client.js';
import { getSession } from '../session.js';
import { coerceAdditionalEquipmentWrite } from '../transforms/arrays.js';
import { isoToUsDate, nowNaiveTimestamp } from '../transforms/dates.js';
import type { DiveUpdate } from '../types.js';
import { getDive } from './get-dive.js';

const MUTATION = `mutation UpdateRecreationalDiveLog(
  $id: Int!,
  $general: logbook_logs_set_input!,
  $depthTime: logbook_depth_time_set_input!,
  $conditions: logbook_conditions_set_input!,
  $equipment: logbook_equipment_set_input!,
  $experience: logbook_experience_set_input!
) {
  update_logbook_logs(where: {id: {_eq: $id}}, _set: $general) {
    affected_rows
  }
  update_logbook_depth_time(where: {logs_id: {_eq: $id}}, _set: $depthTime) {
    affected_rows
  }
  update_logbook_conditions(where: {logs_id: {_eq: $id}}, _set: $conditions) {
    affected_rows
  }
  update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $equipment) {
    affected_rows
  }
  update_logbook_experience(where: {logs_id: {_eq: $id}}, _set: $experience) {
    affected_rows
  }
}`;

export interface UpdateVariables {
  id: number;
  general: Record<string, unknown>;
  depthTime: Record<string, unknown>;
  conditions: Record<string, unknown>;
  equipment: Record<string, unknown>;
  experience: Record<string, unknown>;
}

/**
 * Read the existing dive and merge the partial update on top. Any field the
 * caller didn't pass is filled in from the current value, mirroring what the
 * web UI does (which always sends the full set). This avoids accidentally
 * clobbering unrelated fields with `null` when Hasura applies the `_set`.
 */
export async function buildUpdateVariables(update: DiveUpdate): Promise<UpdateVariables> {
  const { affiliate_id } = getSession();
  const { diveId, ...patch } = update;
  const existing = await getDive(diveId);
  if (!existing) throw new Error(`Dive ${diveId} not found`);

  const pick = <K extends keyof typeof patch>(key: K): (typeof patch)[K] | undefined => {
    return key in patch ? patch[key] : undefined;
  };

  return {
    id: diveId,
    general: {
      affiliate_id,
      log_type: pick('log_type') ?? existing.log_type ?? 'Recreational',
      log_course: pick('log_course') ?? existing.log_course,
      log_number: pick('log_number') ?? existing.log_number,
      update_date: nowNaiveTimestamp(),
      dive_type: pick('dive_type') ?? existing.dive_type,
      dive_title: pick('dive_title') ?? existing.dive_title,
      dive_location: pick('dive_location') ?? existing.dive_location,
      dive_date: isoToUsDate(pick('dive_date') ?? existing.dive_date ?? ''),
      status: pick('status') ?? existing.status ?? 'Publish',
      memsys_member_number: pick('memsys_member_number') ?? existing.memsys_member_number,
      adventure_dive: pick('adventure_dive') ?? existing.adventure_dive,
    },
    depthTime: {
      bottom_time: pick('bottom_time') ?? existing.depth_time?.bottom_time ?? null,
      max_depth: pick('max_depth') ?? existing.depth_time?.max_depth ?? null,
      time_in: pick('time_in') ?? existing.depth_time?.time_in ?? null,
      time_out: pick('time_out') ?? existing.depth_time?.time_out ?? null,
    },
    conditions: {
      water_type: pick('water_type') ?? existing.conditions?.water_type ?? null,
      body_of_water: pick('body_of_water') ?? existing.conditions?.body_of_water ?? null,
      weather: pick('weather') ?? existing.conditions?.weather ?? null,
      air_temp: pick('air_temp') ?? existing.conditions?.air_temp ?? null,
      surface_water_temp:
        pick('surface_water_temp') ?? existing.conditions?.surface_water_temp ?? null,
      bottom_water_temp:
        pick('bottom_water_temp') ?? existing.conditions?.bottom_water_temp ?? null,
      visibility: pick('visibility') ?? existing.conditions?.visibility ?? null,
      visibility_distance:
        pick('visibility_distance') ?? existing.conditions?.visibility_distance ?? null,
      wave_condition: pick('wave_condition') ?? existing.conditions?.wave_condition ?? null,
      current: pick('current') ?? existing.conditions?.current ?? null,
      surge: pick('surge') ?? existing.conditions?.surge ?? null,
    },
    equipment: {
      starting_pressure: pick('starting_pressure') ?? existing.equipment?.starting_pressure ?? null,
      ending_pressure: pick('ending_pressure') ?? existing.equipment?.ending_pressure ?? null,
      suit_type: pick('suit_type') ?? existing.equipment?.suit_type ?? null,
      weight: pick('weight') ?? existing.equipment?.weight ?? null,
      weight_type: pick('weight_type') ?? existing.equipment?.weight_type ?? null,
      additional_equipment: coerceAdditionalEquipmentWrite(
        pick('additional_equipment') ?? existing.equipment?.additional_equipment ?? null,
      ),
      cylinder_type: pick('cylinder_type') ?? existing.equipment?.cylinder_type ?? null,
      cylinder_size: pick('cylinder_size') ?? existing.equipment?.cylinder_size ?? null,
      gas_mixture: pick('gas_mixture') ?? existing.equipment?.gas_mixture ?? null,
      oxygen: pick('oxygen') ?? existing.equipment?.oxygen ?? null,
      nitrogen: pick('nitrogen') ?? existing.equipment?.nitrogen ?? null,
      helium: pick('helium') ?? existing.equipment?.helium ?? null,
    },
    experience: {
      feeling: pick('feeling') ?? existing.experience?.feeling ?? null,
      notes: pick('notes') ?? existing.experience?.notes ?? null,
      buddies: pick('buddies') ?? existing.experience?.buddies ?? null,
      dive_center: pick('dive_center') ?? existing.experience?.dive_center ?? null,
    },
  };
}

export async function updateDive(update: DiveUpdate): Promise<void> {
  const variables = await buildUpdateVariables(update);
  await graphql({
    operationName: 'UpdateRecreationalDiveLog',
    query: MUTATION,
    variables: variables as unknown as Record<string, unknown>,
  });
}
