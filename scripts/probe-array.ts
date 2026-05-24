#!/usr/bin/env tsx
/**
 * One-shot: probe additional_equipment as a real JSON/GraphQL array.
 * Creates a sandbox dive, sends update_logbook_equipment with the array
 * variable typed, reads back the raw value.
 */
import { randomUUID } from 'node:crypto';
import { createDive } from '../src/operations/create-dive.js';
import { deleteDive } from '../src/operations/delete-dive.js';
import { GraphQLError, graphql } from '../src/padi-client.js';
import { loadSession } from '../src/session.js';
import type { DiveInput } from '../src/types.js';

const SANDBOX: DiveInput = {
  dive_title: `MCPTEST_${randomUUID()}`,
  dive_date: '1900-01-01',
  dive_location: 'Array Probe',
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
  notes: 'mcp-test array probe',
  buddies: null,
  dive_center: null,
};

await loadSession();
const id = await createDive(SANDBOX);
console.error('created id=', id);

const READ_RAW = `query Raw($id: Int!) {
  logbook_equipment(where: {logs_id: {_eq: $id}}) { additional_equipment }
}`;
const updates: Array<{ label: string; query: string; vars: Record<string, unknown> }> = [
  {
    label: 'pg literal {Camera,Light}',
    query: `mutation U($id: Int!, $v: logbook_equipment_set_input!) {
      update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $v) { affected_rows }
    }`,
    vars: { id, v: { additional_equipment: '{Camera,Light}' } },
  },
  {
    label: 'pg literal quoted {"Camera","Light"}',
    query: `mutation U($id: Int!, $v: logbook_equipment_set_input!) {
      update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $v) { affected_rows }
    }`,
    vars: { id, v: { additional_equipment: '{"Camera","Light"}' } },
  },
  {
    label: 'pg literal with space {Dive Knife,Surface Marker}',
    query: `mutation U($id: Int!, $v: logbook_equipment_set_input!) {
      update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $v) { affected_rows }
    }`,
    vars: { id, v: { additional_equipment: '{"Dive Knife","Surface Marker"}' } },
  },
  {
    label: 'empty array {}',
    query: `mutation U($id: Int!, $v: logbook_equipment_set_input!) {
      update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $v) { affected_rows }
    }`,
    vars: { id, v: { additional_equipment: '{}' } },
  },
  {
    label: 'set to null',
    query: `mutation U($id: Int!) {
      update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: {additional_equipment: null}) { affected_rows }
    }`,
    vars: { id },
  },
];

try {
  for (const u of updates) {
    try {
      await graphql({ operationName: 'U', query: u.query, variables: u.vars });
      const r = await graphql<{ logbook_equipment: Array<{ additional_equipment: unknown }> }>({
        operationName: 'Raw',
        query: READ_RAW,
        variables: { id },
      });
      const raw = r.logbook_equipment[0]?.additional_equipment ?? null;
      console.error(`✅ ${u.label}: read=${JSON.stringify(raw)} typeof=${typeof raw}`);
    } catch (e) {
      if (e instanceof GraphQLError) {
        console.error(`❌ ${u.label}: ${JSON.stringify(e.errors).slice(0, 250)}`);
      } else throw e;
    }
  }
} finally {
  await deleteDive(id);
  console.error('cleaned up', id);
}
