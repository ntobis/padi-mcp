# Anomalies & wire-format quirks

Non-obvious behaviors of the PADI logbook API, with the workarounds applied in
[`@padi-mcp/core`](../packages/core).

## `dive_date` is read as a naive datetime, not a date

Reads return `dive_date` as `YYYY-MM-DDT00:00:00` (a naive datetime, always at
midnight), even though writes take `MM/DD/YYYY`. The read path normalizes it back
to `YYYY-MM-DD` (`naiveDatetimeToIsoDate()` in `transforms/dates.ts`).

## Hard delete always fails with a foreign-key violation

`delete_logbook_logs` fails 100% of the time with a foreign-key violation
(`conditions_logs_id_fkey`) — the child tables have no `ON DELETE CASCADE`. The
working strategy is a per-table delete in order: `logbook_depth_time` →
`logbook_conditions` → `logbook_equipment` → `logbook_experience` →
`logbook_skills` → `logbook_logs`.

The delete operation still attempts the hard delete first (then caches the
result to skip the wasted attempt) so that if PADI ever adds the cascade FK, it
starts working automatically.

## `additional_equipment` is asymmetric (read JSON array, write pg literal)

The column is a Postgres `text[]` (Hasura scalar `_text`) with different read and
write shapes:

- **Reads** return a JSON array: `["Camera","Light"]`.
- **Writes** require a Postgres array-literal **string**:
  - a real GraphQL list `["Camera"]` → `A string is expected for type: _text`
  - a bare string `"Camera"` → `malformed array literal: "Camera"`
  - a pg-literal string `'{"Camera","Light"}'` → accepted, reads back as the array
  - empty array: send `'{}'`, reads back as `[]`

Handled in `transforms/arrays.ts` (`coerceAdditionalEquipmentWrite` for writes,
`fromAdditionalEquipment` for reads). The canonical TypeScript type is
`string[] | null` both directions.

## `status` enum is narrow — `Trash` is rejected

Setting `status: 'Trash'` does **not** soft-delete; it's rejected
(`invalid input value for enum status: "Trash"`). The accepted values are
`Publish`, `Draft`, `Pending`, so a soft delete uses `Draft`.

## Enum names use underscores, not camelCase

Several enums use underscores between letters and numbers, and combined words
where you might guess otherwise:

- `dive_type`: `BeachShore` (alongside `Boat`, `Other`)
- `suit_type`: `NoExposure`, `Shorty`, `FullSuit_3mm`, `FullSuit_5mm`,
  `FullSuit_7mm`, `SemiDrySuit`, `DrySuit`
- `gas_mixture`: `Enriched_32` / `_36` / `_40` plus `Air`, `Enriched`, `Nitrox`,
  `Trimix`, `Heliox`, `Rebreather`

See [`enums.md`](enums.md) for the full table.

## `gas_mixture` and `oxygen` are not cross-validated

The web UI keeps `gas_mixture` and the `oxygen`/`nitrogen` percentages in sync,
but the API does **not** enforce it — `gas_mixture: Enriched_36` with `oxygen: 21`
is accepted and stored as-is. So a caller setting "nitrox 32" must set both
`gas_mixture: Enriched_32` **and** `oxygen: 32` / `nitrogen: 68`; the backend
won't flag a mismatch.
