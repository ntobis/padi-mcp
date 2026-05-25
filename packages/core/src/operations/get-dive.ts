import { type PadiContext, graphql } from '../padi-client.js';
import { fromAdditionalEquipment } from '../transforms/arrays.js';
import { naiveDatetimeToIsoDate } from '../transforms/dates.js';
import { toNumber } from '../transforms/numbers.js';
import { type Dive, RawDiveDetail } from '../types.js';

const QUERY = `query logbook_logs($affiliate_id: Int!, $id: Int!) {
  logbook_logs(
    where: {affiliate_id: {_eq: $affiliate_id}, _and: {id: {_eq: $id}}}
  ) {
    id
    log_type
    log_course
    log_number
    dive_type
    dive_title
    dive_date
    dive_location
    memsys_member_number
    status
    adventure_dive
    depth_times { max_depth bottom_time time_in time_out }
    skills { dive_skills }
    conditions {
      water_type body_of_water weather air_temp surface_water_temp
      bottom_water_temp visibility visibility_distance wave_condition
      current surge
    }
    equipment {
      suit_type weight weight_type additional_equipment cylinder_type
      cylinder_size gas_mixture oxygen nitrogen helium starting_pressure
      ending_pressure
    }
    experiences { feeling notes buddies dive_center }
  }
}`;

export async function getDive(ctx: PadiContext, diveId: number): Promise<Dive | null> {
  const data = await graphql<{ logbook_logs: unknown[] }>(ctx, {
    operationName: 'logbook_logs',
    query: QUERY,
    variables: { affiliate_id: Number(ctx.affiliateId), id: diveId },
  });
  const row = data.logbook_logs[0];
  if (!row) return null;
  const r = RawDiveDetail.parse(row);
  const dt = r.depth_times[0];
  const c = r.conditions[0];
  const e = r.equipment[0];
  const x = r.experiences[0];
  return {
    id: r.id,
    log_type: r.log_type ?? null,
    log_course: r.log_course ?? null,
    log_number: toNumber(r.log_number),
    dive_type: r.dive_type ?? null,
    dive_title: r.dive_title ?? null,
    dive_date: naiveDatetimeToIsoDate(r.dive_date),
    dive_location: r.dive_location ?? null,
    memsys_member_number: r.memsys_member_number ?? null,
    status: r.status ?? null,
    adventure_dive: r.adventure_dive ?? null,
    depth_time: dt
      ? {
          max_depth: toNumber(dt.max_depth),
          bottom_time: toNumber(dt.bottom_time),
          time_in: dt.time_in ?? null,
          time_out: dt.time_out ?? null,
        }
      : null,
    conditions: c
      ? {
          water_type: c.water_type ?? null,
          body_of_water: c.body_of_water ?? null,
          weather: c.weather ?? null,
          air_temp: toNumber(c.air_temp),
          surface_water_temp: toNumber(c.surface_water_temp),
          bottom_water_temp: toNumber(c.bottom_water_temp),
          visibility: c.visibility ?? null,
          visibility_distance: toNumber(c.visibility_distance),
          wave_condition: c.wave_condition ?? null,
          current: c.current ?? null,
          surge: c.surge ?? null,
        }
      : null,
    equipment: e
      ? {
          suit_type: e.suit_type ?? null,
          weight: toNumber(e.weight),
          weight_type: e.weight_type ?? null,
          additional_equipment: fromAdditionalEquipment(e.additional_equipment),
          cylinder_type: e.cylinder_type ?? null,
          cylinder_size: toNumber(e.cylinder_size),
          gas_mixture: e.gas_mixture ?? null,
          oxygen: toNumber(e.oxygen),
          nitrogen: toNumber(e.nitrogen),
          helium: toNumber(e.helium),
          starting_pressure: toNumber(e.starting_pressure),
          ending_pressure: toNumber(e.ending_pressure),
        }
      : null,
    experience: x
      ? {
          feeling: x.feeling ?? null,
          notes: x.notes ?? null,
          buddies: x.buddies ?? null,
          dive_center: x.dive_center ?? null,
        }
      : null,
  };
}
