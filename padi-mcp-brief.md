# PADI Logbook MCP Server — Implementation Brief

## Mission

Build a local MCP server (TypeScript, Node.js, runs on macOS) that exposes the
PADI dive logbook as MCP tools, allowing an LLM (Claude Desktop or Claude
Code) to list, read, create, update, and delete dives in the authenticated
user's PADI logbook.

PADI's logbook backend is a Hasura GraphQL endpoint that auto-generates
queries and mutations from a Postgres schema. There's no public API and no
documentation, but the schema is regular and the operations the web app fires
are well-understood. This brief contains everything that's been discovered so
far. Your job is to implement against it, fill in the small remaining gaps by
probing, and ship a working MCP server.

Work continuously. Do not stop to ask the user for input unless you hit one of
the explicit stopping conditions. Self-verify every step. Maintain a working
log (`docs/progress.md`) that survives context compaction.

---

## What we already know

### Endpoint

```
POST https://logbook.global-prod.padi.com/api/Logbook
```

### Auth headers (all required)

```
Authorization: Bearer <JWT>
affiliate-id: <integer>
x-platform: web
Content-Type: application/json
Origin: https://learning.padi.com
Referer: https://learning.padi.com/
```

The JWT is a Cognito ID token (RS256). It expires **1 hour** after issue
(`exp - iat = 3600`). The user must re-capture it from DevTools when expired.

### User identifiers (for the user this is being built for)

- `affiliate_id`: `10000000`
- `cognito_sub`: `00000000-0000-0000-0000-000000000000`

Store these as values in `.env` so the code stays generic — don't hardcode.

### Schema overview

The data lives in five related tables. Foreign key to the parent log is
**`logs_id`** in all sub-tables:

```
logbook_logs               -- parent, has id
├── logbook_depth_time     -- (logs_id) max_depth, bottom_time, time_in, time_out
├── logbook_conditions     -- (logs_id) water, weather, temps, visibility, waves
├── logbook_equipment      -- (logs_id) suit, weight, cylinder, gas, pressures
├── logbook_experience     -- (logs_id) feeling, notes, buddies, dive_center
└── logbook_skills         -- (logs_id) dive_skills (read-only from this UI;
                              probably populated only when an instructor
                              verifies a training dive)
```

The dive site search table is separate and not foreign-keyed to logs:

```
logbook_dive_site          -- id, name (for autocomplete only; the chosen
                              site name is stored as plain text in
                              logbook_logs.dive_location)
```

### Hasura naming gotcha

The Postgres tables are singular (`logbook_depth_time`, `logbook_experience`)
but the **relationship names on `logbook_logs`** that you nest under for
inserts/reads are sometimes plural (`depth_times`, `experiences`) and
sometimes singular (`conditions`, `equipment`, `skills`). The shapes below
are exact — don't try to "regularize" them.

### Known GraphQL operations (verbatim — use these exact strings)

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
    depth_times {
      max_depth
      bottom_time
      time_in
      time_out
    }
    skills {
      dive_skills
    }
    conditions {
      water_type
      body_of_water
      weather
      air_temp
      surface_water_temp
      bottom_water_temp
      visibility
      visibility_distance
      wave_condition
      current
      surge
    }
    equipment {
      suit_type
      weight
      weight_type
      additional_equipment
      cylinder_type
      cylinder_size
      gas_mixture
      oxygen
      nitrogen
      helium
      starting_pressure
      ending_pressure
    }
    experiences {
      feeling
      notes
      buddies
      dive_center
    }
  }
}
```

Note: returns an **array** (filtered by id), not a single object. Take `[0]`.

**3. Count dives**

```graphql
query logbook_logs_aggregate($affiliate_id: Int!) {
  logbook_logs_aggregate(where: {affiliate_id: {_eq: $affiliate_id}}) {
    aggregate { count }
  }
}
```

**4. Dive site search (autocomplete)**

```graphql
query logbook_logs($name: String!) {
  logbook_dive_site(where: {name: {_ilike: $name}}) {
    id
    name
  }
}
```

The `name` variable uses SQL LIKE wildcards: `"%South Point%"`. Don't store
the resulting `id` anywhere — the user's chosen site name is saved as a
plain string in `logbook_logs.dive_location`.

**5. Create dive (nested insert)**

```graphql
mutation insert_logbook_logs($general: [logbook_logs_insert_input!]!) {
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
}
```

Sample variables (real shape, observed on the wire):

```json
{
  "general": {
    "affiliate_id": "10000000",
    "log_type": "Recreational",
    "log_course": null,
    "log_number": null,
    "created_date": "2026-05-24T07:59:54",
    "update_date": "2026-05-24T07:59:54",
    "dive_type": "Boat",
    "dive_title": "Sipadan South Point",
    "dive_location": "South Point",
    "dive_date": "05/24/2026",
    "status": "Publish",
    "depth_times":  {"data": {"bottom_time": "50", "max_depth": "20"}},
    "conditions":   {"data": {"water_type": "Salt", "body_of_water": "Ocean", "weather": "Partly Cloudy", "air_temp": "30.000", "surface_water_temp": "30.000", "bottom_water_temp": "25.000", "visibility": "Average", "visibility_distance": "18.000", "wave_condition": "SmallWaves", "current": "SomeCurrent", "surge": "SomeSurge"}},
    "equipment":    {"data": {"starting_pressure": "200", "ending_pressure": "50", "suit_type": "Shorty", "weight": "2", "weight_type": "Good", "additional_equipment": null, "cylinder_type": "Aluminum", "cylinder_size": "9", "gas_mixture": "Air", "oxygen": "21", "nitrogen": "79", "helium": "0"}},
    "experiences":  {"data": {"feeling": "Good", "notes": "- Great Corals\n- Some Sharks\n- Some Turtles", "buddies": "Alone", "dive_center": "Seaventures"}}
  }
}
```

Note: `general` is passed as a single object, even though the GraphQL
variable type is `[logbook_logs_insert_input!]!`. Hasura accepts this and
wraps it. Match the captured shape exactly.

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
}
```

Sample variables: see `samples/update-dive.json` (write this from the curl
the user provided — Claude Code: save the raw mutation payload as a fixture).

### Field semantics & quirks

**Dates:**
- Read: `dive_date` returns as `YYYY-MM-DD` (e.g. `"2026-05-24"`)
- Write: `dive_date` must be sent as `MM/DD/YYYY` (e.g. `"05/24/2026"`)
- `created_date` / `update_date`: ISO 8601 local time, no timezone
  (`"2026-05-24T07:59:54"`). The client populates these; the server may
  also overwrite — verify.

**Numeric fields:** Hasura accepts both strings and numbers for numeric
columns. The web app inconsistently sends strings on insert and numbers
on update. Send numbers — they're cleaner — but the API will accept either.

**Nullable fields:** `log_course`, `log_number`, `memsys_member_number`,
`adventure_dive`, `additional_equipment` — set to `null` when not
applicable.

**Free-text "lookup" fields:** Even though there are search endpoints for
`logbook_dive_site`, the dive_location field stores plain text. Same for
`buddies` and `dive_center` — both are free strings, no foreign keys, no
search resolution needed at write time.

### Known enum values (case-sensitive — match exactly)

Some of these have only been observed with a single value on the wire.
Treat the listed values as confirmed, and the parenthesized ones as
"strongly suspected, must be probed during Phase 4":

| Field | Confirmed | Suspected (probe) |
|---|---|---|
| `log_type` | `Recreational` | `Training` |
| `dive_type` | `Boat` | `Shore`, `Other` |
| `status` | `Publish` | `Draft`, `Trash`/`Deleted` (used by the soft-delete path?) |
| `water_type` | `Salt`, `Fresh` | — |
| `body_of_water` | `Ocean` | `Lake`, `Quarry`, `River`, `Other` |
| `weather` | `Partly Cloudy` | `Sunny`, `Cloudy`, `Rainy`, `Windy`, `Foggy` (note the space in `Partly Cloudy`) |
| `visibility` | `Average` | `High`, `Low` |
| `wave_condition` | `SmallWaves` | `NoWaves`, `MediumWaves`, `LargeWaves` (camelCase!) |
| `current` | `SomeCurrent` | `NoCurrent`, `LightCurrent`, `MediumCurrent`, `StrongCurrent` (camelCase) |
| `surge` | `SomeSurge` | `LightSurge`, `MediumSurge`, `StrongSurge` (camelCase) |
| `suit_type` | `Shorty` | `None`, `FullSuit3mm`, `FullSuit5mm`, `FullSuit7mm`, `SemiDry`, `DrySuit` |
| `weight_type` | `Good` | `Light`, `Heavy` |
| `cylinder_type` | `Aluminum` | `Steel`, `Other` |
| `gas_mixture` | `Air` | `Nitrox32`, `Nitrox36`, `Nitrox40`, `Enriched`, `Trimix`, `Rebreather` |
| `feeling` | `Good` | `Amazing`, `Average`, `Poor` |
| `additional_equipment` | (null) | likely multi-value: array, comma-separated string, or JSON? Probe. UI shows Hood / Gloves / Boots as multi-select. |

For probing methodology: see Phase 4.

### What's still unknown

1. **Delete mutation shape.** Not observed. Could be:
   - Hard delete via `delete_logbook_logs` + cascade (most likely if FKs
     are set up that way)
   - Hard delete via per-table deletes (mirror of the update pattern)
   - Soft delete via setting `status` to `"Trash"` or `"Deleted"`
2. **Full enum value sets** (see table above).
3. **`additional_equipment` shape.** The form shows it as multi-select.
4. **Save-as-Draft path.** The UI has a "Save to Drafts" button — probably
   just `status: "Draft"` but not confirmed.
5. **Training dive flow.** All observed traffic was Recreational. Training
   dives populate `log_course`, `log_number`, and `skills` — out of scope
   for V1 but document anything you discover.
6. **Photo upload.** Out of scope for V1.

---

## Operating principles

1. **Self-verify everything.** Every mutation must be paired with a read
   that confirms the mutation did what you expected. Diff the result against
   the input. Never claim success without verification.
2. **Sandbox first.** All exploration is done against a test dive with a
   clearly fake date (`1900-01-01`) and a title prefixed with
   `MCPTEST_<uuid>`. Always delete test dives after testing. The user's real
   logbook is sacred.
3. **Maintain the log.** After every meaningful action — passing test,
   discovered enum, failure — append to `docs/progress.md` with timestamp.
   This is your persistent memory if context gets compacted.
4. **Resume from the log.** At the start of every session, read
   `docs/progress.md` and `docs/discovered-schema.md` first.
5. **Fail loudly.** Unexpected response shape → log full response to
   `docs/anomalies.md`. Don't silently retry.
6. **Never delete real dives.** Any delete operation against a dive without
   the `MCPTEST_` prefix or with a date after 1950-01-01 requires
   `iAmSureThisIsNotARealDive: true` AND triggers a stopping condition
   for human review.

---

## Inputs the user provides

A single file: **`inputs/session.json`** with this shape:

```json
{
  "endpoint": "https://logbook.global-prod.padi.com/api/Logbook",
  "authorization": "Bearer eyJraWQiOi…",
  "affiliate_id": "10000000",
  "x_platform": "web",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 …",
  "cognito_sub": "00000000-0000-0000-0000-000000000000"
}
```

**How the user captures it:** open Chrome DevTools at `learning.padi.com`,
Network tab, filter `Logbook`, navigate to the logbook page so a real
request fires, right-click any successful request → Copy → Copy as cURL.
Paste into a scratch file. Run the helper script
`scripts/curl-to-session.ts` (you'll write this in Phase 0) which parses
the cURL and emits `inputs/session.json`.

If `inputs/session.json` is missing when needed: **stopping condition**.

If the JWT in `inputs/session.json` returns 401: **stopping condition** —
JWTs expire after 1 hour, the user must re-capture.

Optional fixtures the user *may* provide in `samples/` for reference:
- `samples/list-dives.curl`
- `samples/get-dive.curl`
- `samples/create-dive.curl`
- `samples/update-dive.curl`

If present, use them as the source of truth for the operations above. If
absent, use the embedded queries in this brief.

---

## Tech stack

- **Runtime:** Node.js 20+, TypeScript, ESM modules
- **MCP SDK:** `@modelcontextprotocol/sdk` (latest)
- **GraphQL client:** Plain `fetch` — no Apollo/urql
- **Schema validation:** `zod` for tool inputs and response shapes
- **Dev tooling:** `tsx` for running, `vitest` for tests
- **Lint/format:** `biome`
- **Logging:** `console.error` to stderr (MCP uses stdout for protocol)

No database. No frontend. State lives in memory and `.env`/`session.json`.

---

## Repo structure

```
padi-mcp/
├── README.md
├── package.json
├── tsconfig.json
├── biome.json
├── .env.example
├── .env                          # gitignored
├── .gitignore
├── inputs/                       # gitignored
│   └── session.json
├── samples/                      # gitignored — user-supplied curl captures
├── docs/
│   ├── progress.md
│   ├── discovered-schema.md      # this brief's "What we already know" + your additions
│   ├── field-mapping.md          # complete UI label ↔ GraphQL field map
│   ├── enums.md                  # confirmed enum values
│   ├── anomalies.md
│   └── deletions.log
├── src/
│   ├── index.ts                  # MCP server entrypoint
│   ├── padi-client.ts            # GraphQL client
│   ├── session.ts                # session.json loader + in-memory state
│   ├── types.ts                  # Zod schemas for Dive + sub-objects
│   ├── operations/
│   │   ├── list-dives.ts
│   │   ├── get-dive.ts
│   │   ├── count-dives.ts
│   │   ├── search-dive-sites.ts
│   │   ├── create-dive.ts
│   │   ├── update-dive.ts
│   │   └── delete-dive.ts
│   ├── transforms/
│   │   ├── dates.ts              # YYYY-MM-DD ↔ MM/DD/YYYY
│   │   └── numbers.ts            # string ↔ number coercion
│   └── tools/
│       ├── list-dives.ts
│       ├── get-dive.ts
│       ├── create-dive.ts
│       ├── update-dive.ts
│       ├── delete-dive.ts
│       ├── refresh-session.ts
│       └── dry-run.ts
├── scripts/
│   ├── curl-to-session.ts        # parse cURL → session.json
│   ├── probe.ts                  # CLI to fire individual queries
│   ├── test-lifecycle.ts         # full CRUD sweep
│   └── enum-probe.ts             # try unknown enum values
└── test/
    ├── lifecycle.test.ts
    ├── field-coverage.test.ts
    └── fixtures/
        └── sample-dive.ts
```

---

## Phases

### Phase 0 — Bootstrap

**Objective:** Get the repo building and a minimal MCP server running.

1. Initialize the Node project, install dependencies.
2. Create the directory structure exactly as above.
3. Write a minimal MCP server in `src/index.ts` that exposes a `ping` tool.
4. Write `.env.example` (no secrets, just keys: `LOG_LEVEL=info`).
5. Write `scripts/curl-to-session.ts`: takes a cURL string from stdin or a
   file path, extracts auth header / affiliate-id / x-platform / user-agent,
   emits `inputs/session.json`.
6. Write `README.md` with the cURL capture instructions and how to register
   the server with Claude Desktop.
7. Copy the contents of this brief into `docs/discovered-schema.md`.

**Done when:** `npm run build` succeeds, `npx @modelcontextprotocol/inspector`
can call `ping`, `scripts/curl-to-session.ts` works on a sample cURL.

---

### Phase 1 — Session + client foundation

**Objective:** Working GraphQL client with proper auth and error handling.

1. Implement `src/session.ts`:
   - Loads `inputs/session.json` at startup
   - Exposes current values via accessor
   - Supports `replace(newSession)` for the `refresh_session` tool
   - Validates JWT structure (decode payload, check `exp` field, warn if
     expiry is < 5 minutes away)
2. Implement `src/padi-client.ts`:
   - `fetch`-based GraphQL client
   - Attaches all required headers
   - On 401/403: throw `SessionExpiredError` with a clear message that
     a refresh is needed
   - On GraphQL errors in response body: throw `GraphQLError` with full
     error array
   - Logs request operation name + duration to stderr
3. Implement `src/transforms/dates.ts` and `src/transforms/numbers.ts`.
   Unit-test both.

**Self-verification:**
- Run `scripts/probe.ts` with the count query. Expect a number > 0.

**Done when:** The count query returns a valid number from the real account.

---

### Phase 2 — Read operations

**Objective:** Implement `list-dives`, `get-dive`, `count-dives`,
`search-dive-sites`. All read-only.

1. Implement each operation in `src/operations/` using the verbatim queries
   from "Known GraphQL operations" above.
2. Define Zod schemas in `src/types.ts` for the response shapes. Make all
   fields nullable except `id` — old dives may have sparse data.
3. Add transforms: dates from `YYYY-MM-DD` strings to JS `Date`, numeric
   strings to numbers where appropriate. Keep the Hasura wire format
   separate from the canonical TS shape — define both.
4. Run `list-dives` against the real account. Pick the most recent dive,
   fetch it with `get-dive`, dump to `docs/sample-real-dive.json`
   (gitignored — may contain PII).

**Self-verification:**
- `list-dives` returns at least one dive.
- `get-dive(id)` for the most recent dive returns a non-null result.
- All Zod schemas parse the response without errors. Any failure means the
  schema is wrong — fix it and log the issue in `progress.md`.

**Done when:** Read operations work reliably and types match real responses.

---

### Phase 3 — Write operations (sandboxed)

**Objective:** Implement create, update, delete against test dives only.

**Test dive marker:**
- Title: `MCPTEST_<uuid-v4>`
- Date: `1900-01-01`
- Notes: must contain `mcp-test-do-not-display`

1. **Create.** Implement `src/operations/create-dive.ts` using the verbatim
   mutation. Start with all the fields the captured create mutation used.
   Run it. Verify the response has a non-null `id`. Fetch by id and diff.
2. **Update.** Implement `src/operations/update-dive.ts` using the verbatim
   mutation. Modify one field on the test dive (e.g., notes). Fetch and
   diff. Then test setting a sub-table field (e.g., `equipment.weight`).
3. **Delete.** No mutation captured. Try strategies in this order:
   - **Strategy A — Soft delete:** `update_logbook_logs` with
     `_set: {status: "Trash"}` (try `"Deleted"`, `"Archived"` too). Then
     fetch — if the dive is no longer in the list query, soft delete works.
   - **Strategy B — Hard delete with cascade:**
     ```graphql
     mutation { delete_logbook_logs(where: {id: {_eq: $id}}) { affected_rows } }
     ```
     If `affected_rows: 1`, fetch by id — if empty, cascade worked.
     If `affected_rows: 0` because of FK violation, sub-tables need
     explicit delete first.
   - **Strategy C — Hard delete per table:** mirror the update mutation
     structure with `delete_logbook_*` for each sub-table, then
     `delete_logbook_logs` last.
   - Document which strategy works in `docs/discovered-schema.md`.
4. Build `scripts/test-lifecycle.ts`: create → fetch+diff → update each
   field individually → fetch+diff → delete → confirm gone. Must always
   end with cleanup (try/finally).

**Self-verification:**
- Lifecycle script passes three consecutive times.
- After running, no dives with `MCPTEST_` prefix remain in `list-dives`.

**Done when:** Lifecycle script passes reliably.

---

### Phase 4 — Enum + field probing

**Objective:** Confirm enum value sets and resolve `additional_equipment`.

1. Write `scripts/enum-probe.ts`: for each suspected enum value in the
   table above, attempt to set it on a test dive via update. Three possible
   outcomes:
   - Update succeeds and read returns the value as-sent → confirmed.
   - Update succeeds but read returns a different value (server normalized)
     → record both forms.
   - Update fails with a GraphQL error → not a valid value. Record error.
2. Probe `additional_equipment` shapes: try a JSON string
   `'["Hood","Gloves"]'`, a comma-separated string `"Hood,Gloves"`, an
   array literal, and `null`. Whichever the API accepts and round-trips
   wins.
3. Probe `status` values: try `"Draft"`, `"Trash"`, `"Deleted"`,
   `"Archived"` on the test dive. Whichever is the soft-delete value
   (if any) goes in the delete strategy.
4. Update `docs/enums.md` with every confirmed value and every rejected one.

**Self-verification:**
- For every enum field, at least 2 values confirmed (or documented as
  having a single valid value).

**Done when:** Enum coverage is documented for all fields.

---

### Phase 5 — MCP tool surface

**Objective:** Expose the operations as MCP tools with sensible validation.

**Tools:**

1. **`padi_list_dives`** — args: `limit` (default 20), `offset` (default 0).
2. **`padi_get_dive`** — args: `diveId` (number).
3. **`padi_search_dive_sites`** — args: `query` (string, will be wrapped
   with `%…%` automatically).
4. **`padi_create_dive`** — args: Zod-validated dive input. Required:
   `dive_title`, `dive_date` (accepts `YYYY-MM-DD`, server format applied
   by client), `max_depth`, `bottom_time`. All others optional with
   sensible defaults (e.g., `log_type: "Recreational"`, `status: "Publish"`).
   On success, fetches the dive by returned id and includes the full
   record in the tool result.
5. **`padi_update_dive`** — args: `diveId` + any subset of fields. Internally
   splits the input across the five `_set_input` variables. Fetches and
   returns the updated dive.
6. **`padi_delete_dive`** — args: `diveId`, `confirm: true`. If the dive's
   title doesn't start with `MCPTEST_` AND its date is after `1950-01-01`,
   requires `iAmSureThisIsNotARealDive: true`. Logs to `docs/deletions.log`.
7. **`padi_refresh_session`** — args: `curl` (string, the user's raw cURL
   from DevTools) OR explicit fields (`authorization`, `affiliate_id`,
   `user_agent`). Updates `inputs/session.json` and reloads.
8. **`padi_dry_run`** — args: same as create or update + `operation` field.
   Returns the GraphQL payload that *would* be sent. No side effects.

**MCP tool description conventions:**
- Every tool description starts with what it does, then a one-line note
  about side effects.
- Enum-valued fields list every confirmed value in the description.
- Date fields specify the accepted format (`YYYY-MM-DD`).

**Self-verification:**
- Use `@modelcontextprotocol/inspector` to call each tool.
- For each tool, confirm Zod rejects malformed inputs with helpful errors.
- Round-trip test: `create_dive` → `get_dive` → diff → `update_dive` →
  `get_dive` → diff → `delete_dive` → `get_dive` → expect not found.

**Done when:** All tools pass round-trip tests via the inspector.

---

### Phase 6 — Local install + dictation smoke test

1. Write the `claude_desktop_config.json` snippet for the README:
   ```json
   {
     "mcpServers": {
       "padi": {
         "command": "node",
         "args": ["/absolute/path/to/padi-mcp/dist/index.js"]
       }
     }
   }
   ```
2. Build and install. Confirm Claude Desktop sees the tools.
3. Real dictation test against a test dive (date `1900-01-01`):

   *"Log a dive on January 1st 1900 at Crystal Bay, Nusa Penida. Max depth
   28 meters, bottom time 42 minutes. Boat dive, salt water, ocean, partly
   cloudy. 3mm shorty suit, 12 liter aluminum tank, air, started 200 bar
   ended 50. Buddy was Made. Dive center Blue Corner. Felt amazing. Saw
   mola mola, write that in the notes. Test dive, do not display."*

4. Verify the dive appears in the PADI web logbook at `learning.padi.com`
   with all fields populated correctly.
5. Delete the test dive via `padi_delete_dive`.

**Done when:** A full dictation → dive-in-PADI round trip works end to end.

---

## Stopping conditions

Stop and ask the user only if one of these occurs:

1. **Auth expired and refresh required.** `inputs/session.json` is missing,
   invalid, or returns 401/403 even on a fresh attempt.
2. **Destructive operation outside the sandbox.** Any delete or update
   targeting a dive that doesn't match the test marker convention.
3. **Three consecutive identical failures.** Same operation, same error,
   three times with no new diagnostic information between attempts.
4. **Ambiguous semantics that cannot be inferred from probing.** A field
   exists in the schema but its valid values can't be determined from the
   captured curls or by trying common patterns.
5. **Scope expansion.** Anything outside the brief — no photo upload,
   no new tools, no refactors beyond what's needed for tests to pass.

In all other cases: work continuously, log to `progress.md`, move on.

---

## First action

1. Read `docs/progress.md` if it exists. Resume from the last logged state.
2. If it doesn't exist, begin at Phase 0.
3. Check for `inputs/session.json`. If missing past Phase 0: stopping
   condition.
4. Begin work. Log every meaningful step to `progress.md` with a timestamp.
