# PADI Logbook — API reference

PADI's dive logbook has no public API. This documents the GraphQL surface the
web app uses, reverse-engineered from observed traffic, so the operations in
[`packages/core`](../packages/core) have a written reference. It is descriptive,
not official, and may change without notice.

See also [`enums.md`](enums.md) (accepted field values) and
[`anomalies.md`](anomalies.md) (wire-format quirks).

## Endpoint

```
POST https://logbook.global-prod.padi.com/api/Logbook
```

A Hasura GraphQL endpoint auto-generated from a Postgres schema.

## Authentication

All requests require these headers:

```
Authorization: Bearer <JWT>
affiliate-id: <integer>
x-platform: web
Content-Type: application/json
Origin: https://learning.padi.com
Referer: https://learning.padi.com/
```

The JWT is a Cognito ID token (RS256) that expires **1 hour** after issue
(`exp - iat = 3600`). This project obtains and silently refreshes it from the
user's credentials (see the auth flow in `@padi-mcp/core`); the `affiliate-id`
comes from the token's `custom:affiliate_id` claim. Tenant data is always scoped
to that affiliate id.

## Data model

Dive data lives across five related tables. The foreign key to the parent log is
**`logs_id`** in every sub-table:

```
logbook_logs               -- parent, has id
├── logbook_depth_time     -- (logs_id) max_depth, bottom_time, time_in, time_out
├── logbook_conditions     -- (logs_id) water, weather, temps, visibility, waves
├── logbook_equipment      -- (logs_id) suit, weight, cylinder, gas, pressures
├── logbook_experience     -- (logs_id) feeling, notes, buddies, dive_center
└── logbook_skills         -- (logs_id) dive_skills (read-only here; populated
                              when an instructor verifies a training dive)
```

Dive-site search is a separate table, not foreign-keyed to logs:

```
logbook_dive_site          -- id, name (autocomplete only; the chosen site name
                              is stored as plain text in logbook_logs.dive_location)
```

**Hasura naming gotcha.** The Postgres tables are singular
(`logbook_depth_time`, `logbook_experience`), but the relationship names you nest
under on `logbook_logs` are sometimes plural (`depth_times`, `experiences`) and
sometimes singular (`conditions`, `equipment`, `skills`). The shapes below are
exact — don't try to "regularize" them.

## GraphQL operations

Use these exact operation strings.

**1. List dives**

```graphql
query logbook_logs($affiliate_id: Int!, $limit: Int, $offset: Int) {
  logbook_logs(
    where: {affiliate_id: {_eq: $affiliate_id}}
    order_by: {dive_date: desc, id: desc}
    limit: $limit
    offset: $offset
  ) {
    id
    log_type
    log_course
    log_number
    dive_title
    dive_date
    dive_location
    status
  }
}
```

**2. Get one dive (full detail)**

```graphql
query logbook_logs($affiliate_id: Int!, $id: Int!) {
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
}
```

Returns an **array** (filtered by id), not a single object — take `[0]`.

**3. Count dives**

```graphql
query logbook_logs_aggregate($affiliate_id: Int!) {
  logbook_logs_aggregate(where: {affiliate_id: {_eq: $affiliate_id}}) {
    aggregate { count }
  }
}
```

**4. Dive-site search (autocomplete)**

```graphql
query logbook_logs($name: String!) {
  logbook_dive_site(where: {name: {_ilike: $name}}) {
    id
    name
  }
}
```

`name` uses SQL LIKE wildcards: `"%South Point%"`. Don't store the resulting
`id` — the chosen site name is saved as plain text in `logbook_logs.dive_location`.

**5. Create dive (nested insert)**

```graphql
mutation insert_logbook_logs($general: [logbook_logs_insert_input!]!) {
  insert_logbook_logs(objects: $general) {
    affected_rows
    returning {
      id affiliate_id dive_title dive_type dive_location log_type log_course
      dive_date created_date status adventure_dive
    }
  }
}
```

Example variables (the real wire shape — `general` is passed as a single object
even though the variable type is a list; Hasura wraps it):

```json
{
  "general": {
    "affiliate_id": "<affiliate_id>",
    "log_type": "Recreational",
    "log_course": null,
    "log_number": null,
    "created_date": "2026-01-15T08:30:00",
    "update_date": "2026-01-15T08:30:00",
    "dive_type": "Boat",
    "dive_title": "Example Reef Dive",
    "dive_location": "Example Reef",
    "dive_date": "01/15/2026",
    "status": "Publish",
    "depth_times": {"data": {"bottom_time": "50", "max_depth": "20"}},
    "conditions":  {"data": {"water_type": "Salt", "body_of_water": "Ocean", "weather": "Partly Cloudy", "air_temp": "30.000", "surface_water_temp": "30.000", "bottom_water_temp": "25.000", "visibility": "Average", "visibility_distance": "18.000", "wave_condition": "SmallWaves", "current": "SomeCurrent", "surge": "SomeSurge"}},
    "equipment":   {"data": {"starting_pressure": "200", "ending_pressure": "50", "suit_type": "Shorty", "weight": "2", "weight_type": "Good", "additional_equipment": null, "cylinder_type": "Aluminum", "cylinder_size": "9", "gas_mixture": "Air", "oxygen": "21", "nitrogen": "79", "helium": "0"}},
    "experiences": {"data": {"feeling": "Good", "notes": "Great corals", "buddies": "Alone", "dive_center": "Example Divers"}}
  }
}
```

**6. Update dive (multi-table)**

```graphql
mutation UpdateRecreationalDiveLog(
  $id: Int!,
  $general: logbook_logs_set_input!,
  $depthTime: logbook_depth_time_set_input!,
  $conditions: logbook_conditions_set_input!,
  $equipment: logbook_equipment_set_input!,
  $experience: logbook_experience_set_input!
) {
  update_logbook_logs(where: {id: {_eq: $id}}, _set: $general) { affected_rows }
  update_logbook_depth_time(where: {logs_id: {_eq: $id}}, _set: $depthTime) { affected_rows }
  update_logbook_conditions(where: {logs_id: {_eq: $id}}, _set: $conditions) { affected_rows }
  update_logbook_equipment(where: {logs_id: {_eq: $id}}, _set: $equipment) { affected_rows }
  update_logbook_experience(where: {logs_id: {_eq: $id}}, _set: $experience) { affected_rows }
}
```

**Delete** is not a single documented mutation. In practice a hard delete via
`delete_logbook_logs` is blocked by a foreign-key constraint, so the working
strategy is per-table deletes (mirror of the update pattern); see
`delete-dive.ts` in `@padi-mcp/core`.

## Field semantics & quirks

- **Dates.** Reads return `dive_date` as `YYYY-MM-DD`; writes must send it as
  `MM/DD/YYYY`. `created_date` / `update_date` are ISO-8601 local time with no
  timezone (`2026-01-15T08:30:00`).
- **Numerics.** Hasura accepts both strings and numbers for numeric columns. The
  web app is inconsistent (strings on insert, numbers on update); either works.
- **Nullable fields.** `log_course`, `log_number`, `memsys_member_number`,
  `adventure_dive`, `additional_equipment` — send `null` when not applicable.
- **Free-text fields.** `dive_location`, `buddies`, and `dive_center` are plain
  strings — no foreign keys, no lookup resolution at write time (the dive-site
  search is purely for autocomplete).
- **`additional_equipment`.** A Postgres `text[]` with an asymmetric wire shape:
  reads return a JSON array, writes take a pg-array literal string. See
  [`anomalies.md`](anomalies.md).

For the accepted/rejected enum values of every field, see [`enums.md`](enums.md).
