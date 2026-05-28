# Enum values

Accepted (and notable rejected) values for the PADI logbook's enum fields,
verified empirically by round-tripping against the live API (sent, then read
back). Values are **case-sensitive — match exactly.**

## Accepted values

| Field | Accepted | Rejected (tried, but invalid) |
|---|---|---|
| `log_type` | Recreational, Training | — |
| `dive_type` | Boat, BeachShore, Other | Shore, ShoreDive, Beach, Pool, Cave, Ice, Night, Drift, Wreck |
| `status` | Publish, Draft, Pending | Trash, Deleted, Archived, Archive, Hidden, Private, Public, Active, Inactive |
| `water_type` | Salt, Fresh | — |
| `body_of_water` | Ocean, Lake, Quarry, River, Other | — |
| `weather` | Sunny, Partly Cloudy, Cloudy, Rainy, Windy, Foggy | — |
| `visibility` | High, Average, Low | — |
| `wave_condition` | NoWaves, SmallWaves, MediumWaves, LargeWaves | — |
| `current` | NoCurrent, SomeCurrent, MediumCurrent, StrongCurrent | LightCurrent, LowCurrent, HighCurrent, BigCurrent |
| `surge` | NoSurge, SomeSurge, MediumSurge, BigSurge | LightSurge, StrongSurge, LowSurge, HighSurge |
| `suit_type` | NoExposure, Shorty, FullSuit_3mm, FullSuit_5mm, FullSuit_7mm, SemiDrySuit, DrySuit | None, FullSuit3mm/5mm/7mm, SemiDry, Wetsuit, Dry, Full, FullSuit, Skin, DiveSkin, Drysuit, BoardShorts, Swimsuit |
| `weight_type` | Light, Good, Heavy | — |
| `cylinder_type` | Aluminum, Steel, Other | — |
| `gas_mixture` | Air, Enriched, Enriched_32, Enriched_36, Enriched_40, Nitrox, Trimix, Heliox, Rebreather | Nitrox32, Nitrox36, Nitrox40, EAN, EANx, O2, Oxygen, Argon |
| `feeling` | Amazing, Good, Average, Poor | — |

## Notes & gotchas

- **Underscore-separated, not camelCase or concatenated:** `FullSuit_3mm` (not
  `FullSuit3mm`), `SemiDrySuit` (not `SemiDry`), `Enriched_32` (not `Nitrox32`),
  `BeachShore` (not `Shore`). Every other variant is rejected.
- **`surge` uses `Big*` where `current` uses `Strong*`** — not symmetric.
- **`current` has no Light/Low level** — the smallest non-zero value is
  `SomeCurrent`.
- **Nitrox / oxygen are not cross-validated.** The web UI sends
  `gas_mixture: Enriched_32` *and* the matching `oxygen`/`nitrogen` percentages,
  but the API accepts an inconsistent pair (e.g. `Enriched_36` with `oxygen=21`)
  without error. Callers must keep `gas_mixture` and `oxygen`/`nitrogen` in sync
  themselves. The plain `Enriched` value also works (for custom mixes).
- **`status: Pending`** is accepted; its exact meaning is unknown (likely a
  draft state used by the mobile sync flow).
- **Soft delete** has only one usable target: `Draft`. `Trash` is rejected, so a
  soft delete sets `status: Draft`.
- **`additional_equipment`** reads back as a JSON array of strings but writes
  require a Postgres array-literal string (`'{"Camera","Light"}'`). See
  [`anomalies.md`](anomalies.md); handled in `@padi-mcp/core`.
