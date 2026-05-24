# Anomalies

Append unexpected response shapes, errors that don't fit known patterns,
or behaviors that contradict the brief. Include full GraphQL response bodies.

Format: `## [timestamp] short title` followed by details.

## [2026-05-24T09:07Z] `dive_date` always read as naive datetime, brief said date

Brief: reads return `YYYY-MM-DD`. Reality: every read returns
`YYYY-MM-DDTHH:MM:SS` (always with `T00:00:00`). Confirmed against
20717446 (`2026-05-24T00:00:00`), 20716851, and every sandbox dive we
created. Fixed in `src/operations/{get,list}-dive*.ts` by routing reads
through `naiveDatetimeToIsoDate()` (`src/transforms/dates.ts`).

## [2026-05-24T09:08Z] Hard delete always fails with FK violation

`delete_logbook_logs` fails 100% of the time with
`constraint-violation: Foreign key violation … conditions_logs_id_fkey
on table "conditions"`. PADI's schema does not have ON DELETE CASCADE on
the child tables. Confirmed across 5 separate dives created during
lifecycle + enum-probe runs.

The working strategy is per-table delete in this order:
`logbook_depth_time` → `logbook_conditions` → `logbook_equipment` →
`logbook_experience` → `logbook_skills` → `logbook_logs`.

We keep `hardDelete` first in the strategy order because (a) caching
skips the wasted attempt after the first call and (b) PADI could add the
cascade FK at any time, in which case we'd silently start using it.

## [2026-05-24T09:10Z] `additional_equipment` is asymmetric (read JSON array, write pg literal)

The brief described `additional_equipment` as a string. Empirical:
- Column is Postgres `text[]` (Hasura scalar `_text`).
- Reads return a JSON array: `["Camera","Light"]`.
- Writes require a Postgres array-literal **string**:
  - Real GraphQL list (`["Camera"]`) → error
    `parse-failed: A string is expected for type: _text`.
  - Bare string (`"Camera"`) → error
    `malformed array literal: "Camera"`.
  - Pg literal string (`'{"Camera","Light"}'`) → ✅ accepted, reads back
    as `["Camera","Light"]`.
- Empty array: send `'{}'`, reads as `[]`.

Handled by `src/transforms/arrays.ts`
(`coerceAdditionalEquipmentWrite` for writes,
`fromAdditionalEquipment` for reads). Canonical TS type is
`string[] | null` in both directions.

## [2026-05-24T09:10Z] `status` enum is narrow — `Trash` is rejected

The brief assumed `status: 'Trash'` would soft-delete. It doesn't —
`Trash` is rejected with `data-exception: invalid input value for enum
status: "Trash"`. The only accepted values are `Publish`, `Draft`,
`Pending`. `softDelete()` now defaults to `Draft`.

## [2026-05-24T09:10Z] `dive_type` and `suit_type` have only 2 accepted values each

`dive_type`: only `Boat` and `Other`. Tried Shore, ShoreDive, Beach,
Pool, Cave, Ice, Night, Drift, Wreck — all rejected. The web UI must be
collapsing every non-boat dive type to `Other`.

`suit_type`: only `Shorty` and `DrySuit`. Tried 17 plausible candidates
including FullSuit3mm/5mm/7mm, SemiDry, Wetsuit, Wet, Dry, Skin,
DiveSkin, Bare, Drysuit, BoardShorts, Swimsuit — all rejected. There
are presumably more values the web UI uses; a fresh HAR capture
specifically targeting the suit-type dropdown would reveal them.
