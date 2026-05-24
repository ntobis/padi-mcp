# Enum values — confirmed

Populated by Phase 4 (`npm run enum-probe` + `npm run enum-probe-extra`).
Every value in the "Accepted" column has been round-tripped against the
live PADI API on affiliate 10000000 (see probe-run sections below for
the raw evidence + every rejected candidate).

Legend:
- ✅ confirmed via round-trip (sent, read back equal)
- ❌ rejected by the API (`data-exception: invalid input value for enum …`)
- ❓ suspected but not yet probed

## Consolidated accepted values

| Field | Accepted | Rejected (from candidates tried) |
|---|---|---|
| log_type | Recreational, Training | — |
| dive_type | **Boat, Other** (only 2!) | Shore, ShoreDive, Beach, Pool, Cave, Ice, Night, Drift, Wreck |
| status | Publish, Draft, Pending | Trash, Deleted, Archived, Archive, Hidden, Private, Public, Active, Inactive |
| water_type | Salt, Fresh | — |
| body_of_water | Ocean, Lake, Quarry, River, Other | — |
| weather | Sunny, Partly Cloudy, Cloudy, Rainy, Windy, Foggy | — |
| visibility | High, Average, Low | — |
| wave_condition | NoWaves, SmallWaves, MediumWaves, LargeWaves | — |
| current | NoCurrent, SomeCurrent, MediumCurrent, StrongCurrent | LightCurrent, LowCurrent, HighCurrent, BigCurrent |
| surge | NoSurge, SomeSurge, MediumSurge, **BigSurge** | LightSurge, StrongSurge, LowSurge, HighSurge |
| suit_type | **Shorty, DrySuit** (only 2!) | None, FullSuit3mm, FullSuit5mm, FullSuit7mm, SemiDry, Wetsuit, Wet, Dry, Full, FullSuit, Skin, DiveSkin, Bare, Drysuit, BoardShorts, Swimsuit |
| weight_type | Light, Good, Heavy | — |
| cylinder_type | Aluminum, Steel, Other | — |
| gas_mixture | Air, Nitrox, Enriched, Trimix, Heliox, Rebreather | Nitrox32, Nitrox36, Nitrox40, EAN, EANx, O2, Oxygen, Argon |
| feeling | Amazing, Good, Average, Poor | — |

### Notes / gotchas

- **`dive_type` is binary.** Only `Boat` and `Other` are accepted. The
  web UI almost certainly maps "Shore" → `Other`. We probed every
  obvious shore-flavoured candidate.
- **`suit_type` is binary.** Only `Shorty` and `DrySuit`. There must be
  more values that the web UI exposes; our 17 candidates didn't hit them.
  TODO if the user cares: capture a HAR while the web UI selects every
  suit option and grep the wire payload.
- **`surge` uses `Big*` where `current` uses `Strong*`.** Not symmetric.
- **`current` has no Light/Low/Min variant** — the smallest non-zero
  level is `SomeCurrent`.
- **`gas_mixture: Enriched` is what the web UI sends for Nitrox 32/36/40.**
  Concentration goes in the separate `oxygen` / `nitrogen` fields.
- **`status: Pending` works** but its meaning is unknown — probably the
  draft-of-a-draft used by the offline mobile app sync flow.
- **Soft-delete via `status`**: only `Draft` is a usable destination.
  `Trash` is rejected, so `softDelete()` now defaults to `Draft`.
- **`additional_equipment` is asymmetric**: reads back as a JSON array of
  strings, but writes require a Postgres array literal string
  (`'{"Camera","Light"}'`). See `src/transforms/arrays.ts`.

## Probe run 2026-05-24T09:05:33.456Z

| Field | Value | Outcome | Notes |
|---|---|---|---|
| log_type | Recreational | ✅ |  |
| log_type | Training | ✅ |  |
| dive_type | Boat | ✅ |  |
| dive_type | Shore | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Shore\""}] |
| dive_type | Other | ✅ |  |
| status | Publish | ✅ |  |
| status | Draft | ✅ |  |
| status | Trash | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Trash\""}] |
| status | Deleted | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Deleted\""}] |
| status | Archived | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Archived\""}] |
| water_type | Salt | ✅ |  |
| water_type | Fresh | ✅ |  |
| body_of_water | Ocean | ✅ |  |
| body_of_water | Lake | ✅ |  |
| body_of_water | Quarry | ✅ |  |
| body_of_water | River | ✅ |  |
| body_of_water | Other | ✅ |  |
| weather | Sunny | ✅ |  |
| weather | Partly Cloudy | ✅ |  |
| weather | Cloudy | ✅ |  |
| weather | Rainy | ✅ |  |
| weather | Windy | ✅ |  |
| weather | Foggy | ✅ |  |
| visibility | High | ✅ |  |
| visibility | Average | ✅ |  |
| visibility | Low | ✅ |  |
| wave_condition | NoWaves | ✅ |  |
| wave_condition | SmallWaves | ✅ |  |
| wave_condition | MediumWaves | ✅ |  |
| wave_condition | LargeWaves | ✅ |  |
| current | NoCurrent | ✅ |  |
| current | LightCurrent | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum currents: \"LightCurrent\""} |
| current | SomeCurrent | ✅ |  |
| current | MediumCurrent | ✅ |  |
| current | StrongCurrent | ✅ |  |
| surge | NoSurge | ✅ |  |
| surge | LightSurge | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum surge: \"LightSurge\""}] |
| surge | SomeSurge | ✅ |  |
| surge | MediumSurge | ✅ |  |
| surge | StrongSurge | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum surge: \"StrongSurge\""}] |
| suit_type | None | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"None\""}] |
| suit_type | Shorty | ✅ |  |
| suit_type | FullSuit3mm | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"FullSuit3mm\""}] |
| suit_type | FullSuit5mm | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"FullSuit5mm\""}] |
| suit_type | FullSuit7mm | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"FullSuit7mm\""}] |
| suit_type | SemiDry | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"SemiDry\""}] |
| suit_type | DrySuit | ✅ |  |
| weight_type | Light | ✅ |  |
| weight_type | Good | ✅ |  |
| weight_type | Heavy | ✅ |  |
| cylinder_type | Aluminum | ✅ |  |
| cylinder_type | Steel | ✅ |  |
| cylinder_type | Other | ✅ |  |
| gas_mixture | Air | ✅ |  |
| gas_mixture | Nitrox32 | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"Nitrox32\""}] |
| gas_mixture | Nitrox36 | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"Nitrox36\""}] |
| gas_mixture | Nitrox40 | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"Nitrox40\""}] |
| gas_mixture | Enriched | ✅ |  |
| gas_mixture | Trimix | ✅ |  |
| gas_mixture | Rebreather | ✅ |  |
| feeling | Amazing | ✅ |  |
| feeling | Good | ✅ |  |
| feeling | Average | ✅ |  |
| feeling | Poor | ✅ |  |

## Extra probe run 2026-05-24T09:07:29.980Z

| Field | Value | Outcome | Notes |
|---|---|---|---|
| dive_type | ShoreDive | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"ShoreDive\""}] |
| dive_type | Beach | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Beach\""}] |
| dive_type | Pool | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Pool\""}] |
| dive_type | Cave | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Cave\""}] |
| dive_type | Ice | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Ice\""}] |
| dive_type | Night | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Night\""}] |
| dive_type | Drift | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Drift\""}] |
| dive_type | Wreck | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum dive_type: \"Wreck\""}] |
| status | Pending | ✅ |  |
| status | Hidden | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Hidden\""}] |
| status | Private | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Private\""}] |
| status | Public | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Public\""}] |
| status | Active | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Active\""}] |
| status | Inactive | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Inactive\""}] |
| status | Archive | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum status: \"Archive\""}] |
| suit_type | Wetsuit | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Wetsuit\""}] |
| suit_type | Wet | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Wet\""}] |
| suit_type | Dry | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Dry\""}] |
| suit_type | Full | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Full\""}] |
| suit_type | FullSuit | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"FullSuit\""}] |
| suit_type | Skin | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Skin\""}] |
| suit_type | DiveSkin | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"DiveSkin\""}] |
| suit_type | Bare | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Bare\""}] |
| suit_type | Drysuit | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Drysuit\""}] |
| suit_type | BoardShorts | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"BoardShorts\""}] |
| suit_type | Swimsuit | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum suit: \"Swimsuit\""}] |
| gas_mixture | Nitrox | ✅ |  |
| gas_mixture | EAN | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"EAN\""}] |
| gas_mixture | EANx | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"EANx\""}] |
| gas_mixture | Heliox | ✅ |  |
| gas_mixture | O2 | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"O2\""}] |
| gas_mixture | Oxygen | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"Oxygen\""}] |
| gas_mixture | Argon | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum gas_mixture: \"Argon\""}] |
| surge | LowSurge | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum surge: \"LowSurge\""}] |
| surge | HighSurge | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum surge: \"HighSurge\""}] |
| surge | BigSurge | ✅ |  |
| current | LowCurrent | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum currents: \"LowCurrent\""}] |
| current | HighCurrent | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum currents: \"HighCurrent\""}] |
| current | BigCurrent | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"invalid input value for enum currents: \"BigCurrent\""}] |
| additional_equipment | plain string: "Camera" | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"malformed array literal: \"Camera\""}] |
| additional_equipment | comma list: "Camera, Light" | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"malformed array literal: \"Camera, Light\""}] |
| additional_equipment | JSON array: "[\"Camera\",\"Light\"]" | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"malformed array literal: \"[\"Camera\",\"Light\"]\""}] |
| additional_equipment | newline list: "Camera\nLight" | ❌ | [{"extensions":{"path":"$","code":"data-exception"},"message":"malformed array literal: \"Camera\nLight\""}] |
