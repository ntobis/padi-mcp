/**
 * Zod schemas for canonical TS dive shapes + raw Hasura wire shapes.
 *
 * The "raw" shapes match exactly what PADI returns on the wire (strings
 * for numerics, US-style dates only on writes). The "canonical" shapes
 * are what the MCP tools surface to the LLM: numbers as numbers, dates
 * as ISO `YYYY-MM-DD`.
 */
import { z } from 'zod';

// ---------- Raw wire shapes (read) ----------

const RawNumber = z
  .union([z.string(), z.number()])
  .nullable()
  .optional();

export const RawDepthTime = z.object({
  max_depth: RawNumber,
  bottom_time: RawNumber,
  time_in: z.string().nullable().optional(),
  time_out: z.string().nullable().optional(),
});

export const RawConditions = z.object({
  water_type: z.string().nullable().optional(),
  body_of_water: z.string().nullable().optional(),
  weather: z.string().nullable().optional(),
  air_temp: RawNumber,
  surface_water_temp: RawNumber,
  bottom_water_temp: RawNumber,
  visibility: z.string().nullable().optional(),
  visibility_distance: RawNumber,
  wave_condition: z.string().nullable().optional(),
  current: z.string().nullable().optional(),
  surge: z.string().nullable().optional(),
});

export const RawEquipment = z.object({
  suit_type: z.string().nullable().optional(),
  weight: RawNumber,
  weight_type: z.string().nullable().optional(),
  additional_equipment: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  cylinder_type: z.string().nullable().optional(),
  cylinder_size: RawNumber,
  gas_mixture: z.string().nullable().optional(),
  oxygen: RawNumber,
  nitrogen: RawNumber,
  helium: RawNumber,
  starting_pressure: RawNumber,
  ending_pressure: RawNumber,
});

export const RawExperience = z.object({
  feeling: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  buddies: z.string().nullable().optional(),
  dive_center: z.string().nullable().optional(),
});

export const RawSkills = z.object({
  dive_skills: z.unknown().nullable().optional(),
});

export const RawDiveListItem = z.object({
  id: z.number(),
  log_type: z.string().nullable().optional(),
  log_course: z.string().nullable().optional(),
  log_number: RawNumber,
  dive_title: z.string().nullable().optional(),
  dive_date: z.string().nullable().optional(),
  dive_location: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export const RawDiveDetail = RawDiveListItem.extend({
  dive_type: z.string().nullable().optional(),
  memsys_member_number: z.string().nullable().optional(),
  adventure_dive: z.string().nullable().optional(),
  depth_times: z.array(RawDepthTime).default([]),
  skills: z.array(RawSkills).default([]),
  conditions: z.array(RawConditions).default([]),
  equipment: z.array(RawEquipment).default([]),
  experiences: z.array(RawExperience).default([]),
});

export type RawDiveDetail = z.infer<typeof RawDiveDetail>;
export type RawDiveListItem = z.infer<typeof RawDiveListItem>;

// ---------- Canonical TS shapes (what tools expose) ----------

export const Dive = z.object({
  id: z.number(),
  log_type: z.string().nullable(),
  log_course: z.string().nullable(),
  log_number: z.number().nullable(),
  dive_type: z.string().nullable(),
  dive_title: z.string().nullable(),
  dive_date: z.string().nullable(), // YYYY-MM-DD
  dive_location: z.string().nullable(),
  memsys_member_number: z.string().nullable(),
  status: z.string().nullable(),
  adventure_dive: z.string().nullable(),
  depth_time: z
    .object({
      max_depth: z.number().nullable(),
      bottom_time: z.number().nullable(),
      time_in: z.string().nullable(),
      time_out: z.string().nullable(),
    })
    .nullable(),
  conditions: z
    .object({
      water_type: z.string().nullable(),
      body_of_water: z.string().nullable(),
      weather: z.string().nullable(),
      air_temp: z.number().nullable(),
      surface_water_temp: z.number().nullable(),
      bottom_water_temp: z.number().nullable(),
      visibility: z.string().nullable(),
      visibility_distance: z.number().nullable(),
      wave_condition: z.string().nullable(),
      current: z.string().nullable(),
      surge: z.string().nullable(),
    })
    .nullable(),
  equipment: z
    .object({
      suit_type: z.string().nullable(),
      weight: z.number().nullable(),
      weight_type: z.string().nullable(),
      additional_equipment: z.union([z.string(), z.array(z.string())]).nullable(),
      cylinder_type: z.string().nullable(),
      cylinder_size: z.number().nullable(),
      gas_mixture: z.string().nullable(),
      oxygen: z.number().nullable(),
      nitrogen: z.number().nullable(),
      helium: z.number().nullable(),
      starting_pressure: z.number().nullable(),
      ending_pressure: z.number().nullable(),
    })
    .nullable(),
  experience: z
    .object({
      feeling: z.string().nullable(),
      notes: z.string().nullable(),
      buddies: z.string().nullable(),
      dive_center: z.string().nullable(),
    })
    .nullable(),
});
export type Dive = z.infer<typeof Dive>;

export const DiveSummary = z.object({
  id: z.number(),
  log_type: z.string().nullable(),
  log_course: z.string().nullable(),
  log_number: z.number().nullable(),
  dive_title: z.string().nullable(),
  dive_date: z.string().nullable(),
  dive_location: z.string().nullable(),
  status: z.string().nullable(),
});
export type DiveSummary = z.infer<typeof DiveSummary>;

// ---------- Tool input shapes (write) ----------

export const DiveInput = z.object({
  dive_title: z.string().min(1),
  dive_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use YYYY-MM-DD'),
  dive_location: z.string().nullable().optional(),
  dive_type: z.string().nullable().optional(),
  log_type: z.string().default('Recreational'),
  log_course: z.string().nullable().optional(),
  log_number: z.number().nullable().optional(),
  status: z.string().default('Publish'),
  adventure_dive: z.string().nullable().optional(),
  memsys_member_number: z.string().nullable().optional(),
  // Depth/time
  max_depth: z.number().nullable().optional(),
  bottom_time: z.number().nullable().optional(),
  time_in: z.string().nullable().optional(),
  time_out: z.string().nullable().optional(),
  // Conditions
  water_type: z.string().nullable().optional(),
  body_of_water: z.string().nullable().optional(),
  weather: z.string().nullable().optional(),
  air_temp: z.number().nullable().optional(),
  surface_water_temp: z.number().nullable().optional(),
  bottom_water_temp: z.number().nullable().optional(),
  visibility: z.string().nullable().optional(),
  visibility_distance: z.number().nullable().optional(),
  wave_condition: z.string().nullable().optional(),
  current: z.string().nullable().optional(),
  surge: z.string().nullable().optional(),
  // Equipment
  suit_type: z.string().nullable().optional(),
  weight: z.number().nullable().optional(),
  weight_type: z.string().nullable().optional(),
  additional_equipment: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  cylinder_type: z.string().nullable().optional(),
  cylinder_size: z.number().nullable().optional(),
  gas_mixture: z.string().nullable().optional(),
  oxygen: z.number().nullable().optional(),
  nitrogen: z.number().nullable().optional(),
  helium: z.number().nullable().optional(),
  starting_pressure: z.number().nullable().optional(),
  ending_pressure: z.number().nullable().optional(),
  // Experience
  feeling: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  buddies: z.string().nullable().optional(),
  dive_center: z.string().nullable().optional(),
});
export type DiveInput = z.infer<typeof DiveInput>;

// Update is dive_id + subset.
export const DiveUpdate = DiveInput.partial().extend({
  diveId: z.number(),
});
export type DiveUpdate = z.infer<typeof DiveUpdate>;
