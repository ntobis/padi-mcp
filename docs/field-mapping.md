# Field mapping — PADI logbook UI ↔ GraphQL

How the dive-form fields seen in the PADI web UI map to GraphQL fields, their
table, and any transform applied. A representative subset; for the full set of
fields and operations see [`discovered-schema.md`](discovered-schema.md).

| UI label | Table | Field | Transform |
|---|---|---|---|
| Title | logbook_logs | dive_title | none |
| Date | logbook_logs | dive_date | YYYY-MM-DD ↔ MM/DD/YYYY |
| Location | logbook_logs | dive_location | plain text |
| Dive type | logbook_logs | dive_type | enum |
| Max depth | logbook_depth_time | max_depth | string ↔ number |
| Bottom time | logbook_depth_time | bottom_time | string ↔ number |
| Time in | logbook_depth_time | time_in | time string |
| Time out | logbook_depth_time | time_out | time string |
