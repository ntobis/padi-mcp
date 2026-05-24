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

## [2026-05-24T09:10Z] `dive_type`, `suit_type`, `gas_mixture` enum names use underscores

Initial guesses (FullSuit3mm, Nitrox32, Shore) all failed. A fresh HAR
capture (`inputs/moreoptions{1,2}.har`) targeting the web UI dropdowns
revealed the real naming convention uses underscores between letters
and numbers, plus the words "Beach" + "Shore" combined:

- `dive_type`: `BeachShore` (third value, alongside `Boat` and `Other`)
- `suit_type`: `NoExposure`, `Shorty`, `FullSuit_3mm`, `FullSuit_5mm`,
  `FullSuit_7mm`, `SemiDrySuit`, `DrySuit`
- `gas_mixture`: adds `Enriched_32`, `Enriched_36`, `Enriched_40`
  on top of the previously-known `Air`, `Enriched`, `Trimix`, `Heliox`,
  `Rebreather`, `Nitrox`

All round-tripped against live API.

## [2026-05-24T09:32Z] gas_mixture and oxygen are NOT validated for consistency

The web UI gates Enriched_32 with oxygen=32, Enriched_36 with oxygen=36
etc. — the user thought this was an API requirement. It is not. Sent
`gas_mixture: Enriched_36, oxygen: 21` directly to the API and it
accepted without complaint, read back as written. Same for
`Enriched_32` left with `oxygen` unchanged from a prior `Air` (21).

Implication: when a user dictates "I dove on Nitrox 32" the tool must
set BOTH `gas_mixture: Enriched_32` AND `oxygen: 32` / `nitrogen: 68`
itself — the backend won't fail loudly if they drift apart, just
silently store the inconsistent state.
