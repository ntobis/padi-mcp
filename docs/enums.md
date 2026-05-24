# Enum values — confirmed

This file is populated during Phase 4 (enum probing). Initial seed comes from
the brief's "Known enum values" table.

Legend:
- ✅ confirmed via round-trip (sent, read back equal)
- 🟡 observed in HAR/captured traffic (not yet round-tripped)
- ❌ rejected by the API (with error string)
- ❓ suspected but not yet probed

| Field | Value | Status | Notes |
|---|---|---|---|
| log_type | Recreational | 🟡 | from brief |
| log_type | Training | ❓ | suspected |
| dive_type | Boat | 🟡 | from brief |
| dive_type | Shore | ❓ | suspected |
| dive_type | Other | ❓ | suspected |
| status | Publish | 🟡 | from brief |
| status | Draft | ❓ | suspected (Save to Drafts button) |
| status | Trash | ❓ | suspected (soft delete?) |
| water_type | Salt | 🟡 | from brief |
| water_type | Fresh | ❓ | suspected |
| body_of_water | Ocean | 🟡 | from brief |
| weather | Partly Cloudy | 🟡 | note: space |
| weather | Cloudy | 🟡 | from HAR capture |
| visibility | Average | 🟡 | from brief |
| wave_condition | SmallWaves | 🟡 | camelCase |
| current | SomeCurrent | 🟡 | camelCase |
| current | MediumCurrent | 🟡 | from HAR capture |
| surge | SomeSurge | 🟡 | camelCase |
| suit_type | Shorty | 🟡 | from brief |
| weight_type | Good | 🟡 | from brief |
| cylinder_type | Aluminum | 🟡 | from brief |
| gas_mixture | Air | 🟡 | from brief |
| feeling | Good | 🟡 | from brief |
