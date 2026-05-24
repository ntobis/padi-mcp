# Field mapping — PADI logbook UI ↔ GraphQL

To be populated during Phase 2 (read) and Phase 3 (write). For each UI
label, record the GraphQL field, table, and any transform applied.

| UI label | Table | Field | Transform |
|---|---|---|---|
| Title | logbook_logs | dive_title | none |
| Date | logbook_logs | dive_date | YYYY-MM-DD ↔ MM/DD/YYYY |
| Location | logbook_logs | dive_location | plain text |
| Dive type | logbook_logs | dive_type | enum |
| Max depth | logbook_depth_time | max_depth | string ↔ number |
| Bottom time | logbook_depth_time | bottom_time | string ↔ number |
| Time in | logbook_depth_time | time_in | TBD |
| Time out | logbook_depth_time | time_out | TBD |
