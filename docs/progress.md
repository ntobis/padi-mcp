# Progress Log

This file is the persistent memory for the PADI MCP build. Read this and
`docs/discovered-schema.md` first if context was compacted.

Format: `[ISO timestamp] [PHASE] message`. One line per meaningful step.

## 2026-05-24

- `[2026-05-24T08:20:00Z] [P0] Read padi-mcp-brief.md end-to-end. Branch claude/relaxed-hopper-lvhj5 already checked out, clean tree.`
- `[2026-05-24T08:20:30Z] [P0] Found inputs/learning.padi.com-divelog-create-view-edit.har (16MB) — a full HAR capture, not just a single cURL. Plan to write scripts/har-to-session.ts in addition to scripts/curl-to-session.ts so we can extract auth + sample mutations + enum values from it.`
- `[2026-05-24T08:21:00Z] [P0] Created directory structure (docs/, samples/, src/{operations,transforms,tools}/, scripts/, test/fixtures/). Wrote package.json, tsconfig.json, biome.json, .gitignore, .env.example.`
- `[2026-05-24T08:21:30Z] [P0] Copied brief to docs/discovered-schema.md. Created docs/progress.md (this file).`
- `[2026-05-24T08:25:00Z] [P0] Wrote scripts/curl-to-session.ts and scripts/har-to-session.ts. npm install successful (142 packages).`
- `[2026-05-24T08:27:00Z] [P0] Parsed HAR — 50 logbook POSTs. Operations: logbook_units_settings (bonus), logbook_dive_site search, logbook_logs (list+get), logbook_logs_aggregate (count), logbook_depth_time_aggregate (sum bottom_time — bonus), insert_logbook_logs, UpdateRecreationalDiveLog. Saved one sample per op to samples/.`
- `[2026-05-24T08:27:30Z] [P0] HAR Authorization header was stripped by Chrome (expected). session.json written with empty authorization — need cURL paste later for live testing. Continuing with non-auth work.`
- `[2026-05-24T08:28:00Z] [P0] NEW ENUM VALUES from HAR samples (confirmed via captured wire traffic, status 🟡): weather=Cloudy, current=MediumCurrent, cylinder_size=11 (numeric, not enum). Update payload uses numbers (cylinder_size: 11) whereas insert uses strings ("11") — confirms brief's note that API accepts both.`
- `[2026-05-24T08:28:30Z] [P0] Real dive_id 20716851 was used for the captured update — but it's a real recent dive (date 05/24/2026), NOT a sandbox dive, so we must not touch it. Sandbox creation will use MCPTEST_<uuid> + 1900-01-01.`
- `[2026-05-24T08:35:00Z] [P1] Wrote src/session.ts (loader, JWT decode, expiry warnings), src/padi-client.ts (fetch + SessionExpiredError/GraphQLError/HttpError), src/transforms/{dates,numbers}.ts. Verified nowNaiveTimestamp(date) matches captured wire format BYTE-FOR-BYTE: HAR insert created_date="2026-05-24T07:42:39" for request fired at 07:42:39.621Z (UTC wall-clock, no TZ suffix).`
- `[2026-05-24T08:38:00Z] [P2] Wrote src/types.ts (RawDive*, canonical Dive, DiveInput, DiveUpdate) and operations/{list-dives,get-dive,count-dives,search-dive-sites}.ts. All match verbatim queries from brief.`
- `[2026-05-24T08:40:00Z] [P3] Wrote operations/create-dive.ts (string numerics, mirrors HAR insert payload), update-dive.ts (reads existing + merges patch + sends all 5 _set blocks like web UI), delete-dive.ts (3 strategies: hard → per-table → soft, with caching + cleanup).`
- `[2026-05-24T08:42:00Z] [P5] Wrote src/index.ts with 10 tools (ping + 9 padi_*). Enum hints embedded in tool descriptions. Delete tool refuses non-sandbox dives unless iAmSureThisIsNotARealDive=true. Refresh tool accepts raw cURL OR explicit fields.`
- `[2026-05-24T08:42:30Z] [P0] scripts/test-lifecycle.ts (create+diff+update+diff+delete with try/finally cleanup) and scripts/enum-probe.ts (probes all 15 enum fields, appends results to docs/enums.md).`
- `[2026-05-24T08:43:00Z] [P0] DECISION: Moved cURL-parse helper out of scripts/ into src/curl-parser.ts so the MCP server can import it without dragging scripts/ into the build. Added tsconfig.build.json (src→dist only). Resulting bin path is dist/index.js — matches the Claude Desktop config in the brief.`
- `[2026-05-24T08:45:00Z] [P1] All transform unit tests pass (7/7). Clean TS build. Clean typecheck (scripts + tests).`
- `[2026-05-24T08:47:00Z] [P0→P5] MCP server smoke-tested with manual JSON-RPC: initialize OK, tools/list returns all 10 tools with correct JSON schemas, tools/call ping returns pong + session=no session loaded. ping handles missing session gracefully.`
- `[2026-05-24T08:48:00Z] [STOP] Stopping condition reached: need a fresh cURL paste from Chrome DevTools to populate the JWT in inputs/session.json. Without it I cannot verify Phase 1 (count query), Phase 2 (read round-trip), Phase 3 (lifecycle), Phase 4 (enum probe), or Phase 6 (Claude Desktop smoke test). All code is in place; this is a pure "live API access required" block.`
- `[2026-05-24T08:50:00Z] [P1] User pasted cURL. Parsed via scripts/curl-to-session.ts — affiliate_id=14867369, sub=df250b39-eca4-4b74-90a0-ffe3f07a3fed, JWT exp in ~3500s.`
- `[2026-05-24T08:51:00Z] [STOP] HARD BLOCKER: This Claude Code sandbox cannot reach logbook.global-prod.padi.com. Every request returns HTTP 403 with header "x-deny-reason: host_not_allowed" and body "Host not in allowlist". This is NOT a PADI auth failure — the JWT is valid; it's the environment's outbound network policy. Added NetworkPolicyError class to padi-client.ts so future failures of this kind get a clear message instead of being misreported as SessionExpired. User needs to either (a) add logbook.global-prod.padi.com to the environment's network allowlist, or (b) clone the branch and run npm run lifecycle / npm run probe / npm run enum-probe locally on their Mac (the same machine where they captured the cURL). All local code-path tests (transforms 7/7) still pass; the MCP server still starts cleanly.`



