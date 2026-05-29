#!/usr/bin/env tsx
/**
 * End-to-end MCP stdio smoke test.
 *
 * Spawns dist/index.js as a child process and drives it via newline-delimited
 * JSON-RPC (the framing used by @modelcontextprotocol/sdk's
 * StdioServerTransport). Exercises every tool that doesn't require human
 * confirmation, including a sandbox dive create → get → update → delete
 * round trip.
 *
 * Prints a PASS/FAIL line per call and a final summary. Exits non-zero on
 * any failure.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

interface RpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}
interface RpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const SERVER = resolve(process.cwd(), 'dist/index.js');
const child = spawn(process.execPath, [SERVER], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: process.env,
});

let nextId = 1;
const pending = new Map<number, (r: RpcResponse) => void>();
let buf = '';
child.stdout.on('data', (chunk: Buffer) => {
  buf += chunk.toString('utf8');
  let nl = buf.indexOf('\n');
  while (nl >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    nl = buf.indexOf('\n');
    if (!line) continue;
    let msg: RpcResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error('parse-fail:', line);
      continue;
    }
    if (msg.id != null) {
      const cb = pending.get(msg.id);
      if (cb) {
        pending.delete(msg.id);
        cb(msg);
      }
    }
  }
});

function rpc(method: string, params?: unknown): Promise<RpcResponse> {
  const id = nextId++;
  const req: RpcRequest = { jsonrpc: '2.0', id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify(req)}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 30_000);
  });
}

function notify(method: string, params?: unknown): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const checks: Check[] = [];
function pass(name: string, detail = ''): void {
  checks.push({ name, ok: true, detail });
  console.error(`✅ ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name: string, detail: string): void {
  checks.push({ name, ok: false, detail });
  console.error(`❌ ${name} — ${detail}`);
}

function unwrapText(result: unknown): string {
  const r = result as { content?: Array<{ type: string; text: string }> };
  return r?.content?.[0]?.text ?? '';
}

async function main(): Promise<void> {
  // 1. initialize
  const init = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'mcp-smoke', version: '0.0.0' },
  });
  if (init.error) {
    fail('initialize', init.error.message);
    throw new Error('init failed');
  }
  pass('initialize');
  notify('notifications/initialized');

  // 2. tools/list
  const list = await rpc('tools/list', {});
  if (list.error) {
    fail('tools/list', list.error.message);
  } else {
    const tools = (list.result as { tools: Array<{ name: string }> }).tools;
    const names = tools.map((t) => t.name).sort();
    const expected = [
      'padi_count_dives',
      'padi_create_dive',
      'padi_delete_dive',
      'padi_dry_run',
      'padi_get_dive',
      'padi_list_dives',
      'padi_refresh_session',
      'padi_search_dive_sites',
      'padi_update_dive',
      'ping',
    ];
    const missing = expected.filter((n) => !names.includes(n));
    if (missing.length > 0) fail('tools/list', `missing: ${missing.join(',')}`);
    else pass('tools/list', `${tools.length} tools`);
  }

  // 3. ping
  const ping = await rpc('tools/call', { name: 'ping', arguments: {} });
  if (ping.error) fail('ping', ping.error.message);
  else {
    const t = unwrapText(ping.result);
    if (t.includes('"status": "pong"')) pass('ping', 'pong');
    else fail('ping', `unexpected: ${t.slice(0, 100)}`);
  }

  // 4. padi_count_dives
  const count = await rpc('tools/call', { name: 'padi_count_dives', arguments: {} });
  if (count.error) fail('padi_count_dives', count.error.message);
  else {
    const t = unwrapText(count.result);
    const m = /"count":\s*(\d+)/.exec(t);
    if (m) pass('padi_count_dives', `count=${m[1]}`);
    else fail('padi_count_dives', t.slice(0, 100));
  }

  // 5. padi_list_dives (limit 2)
  const ls = await rpc('tools/call', {
    name: 'padi_list_dives',
    arguments: { limit: 2 },
  });
  if (ls.error) fail('padi_list_dives', ls.error.message);
  else {
    const t = unwrapText(ls.result);
    const parsed = JSON.parse(t) as Array<{ id: number }>;
    if (Array.isArray(parsed) && parsed.length === 2) {
      pass('padi_list_dives', `got 2 ids: ${parsed.map((d) => d.id).join(',')}`);
    } else fail('padi_list_dives', `not 2 rows: ${t.slice(0, 100)}`);
  }

  // 6. padi_search_dive_sites
  const search = await rpc('tools/call', {
    name: 'padi_search_dive_sites',
    arguments: { query: 'Sipadan' },
  });
  if (search.error) fail('padi_search_dive_sites', search.error.message);
  else {
    const t = unwrapText(search.result);
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed))
      pass('padi_search_dive_sites', `${parsed.length} results for "Sipadan"`);
    else fail('padi_search_dive_sites', t.slice(0, 100));
  }

  // 7. padi_dry_run (create) — no side effects
  const dryRun = await rpc('tools/call', {
    name: 'padi_dry_run',
    arguments: {
      operation: 'create',
      input: {
        dive_title: `MCPTEST_${randomUUID()}`,
        dive_date: '1900-01-01',
        dive_type: 'Boat',
        water_type: 'Salt',
        max_depth: 10,
        bottom_time: 30,
      },
    },
  });
  if (dryRun.error) fail('padi_dry_run', dryRun.error.message);
  else {
    const t = unwrapText(dryRun.result);
    if (t.includes('insert_logbook_logs') || t.includes('"general":'))
      pass('padi_dry_run', 'shape ok');
    else fail('padi_dry_run', t.slice(0, 100));
  }

  // 8–11. Sandbox round-trip: create → get → update → delete
  const sandboxTitle = `MCPTEST_${randomUUID()}`;
  let createdId: number | null = null;
  const create = await rpc('tools/call', {
    name: 'padi_create_dive',
    arguments: {
      dive_title: sandboxTitle,
      dive_date: '1900-01-01',
      dive_location: 'MCP Smoke Test',
      dive_type: 'Boat',
      log_type: 'Recreational',
      status: 'Publish',
      max_depth: 12,
      bottom_time: 40,
      water_type: 'Salt',
      body_of_water: 'Ocean',
      weather: 'Sunny',
      visibility: 'Average',
      wave_condition: 'SmallWaves',
      current: 'SomeCurrent',
      surge: 'SomeSurge',
      suit_type: 'Shorty',
      weight: 2,
      weight_type: 'Good',
      cylinder_type: 'Aluminum',
      cylinder_size: 10,
      gas_mixture: 'Air',
      additional_equipment: ['Camera', 'Compass'],
      starting_pressure: 200,
      ending_pressure: 50,
      feeling: 'Good',
      notes: 'mcp-smoke',
      dive_center: 'Smoke Test Center',
    },
  });
  if (create.error) {
    fail('padi_create_dive', create.error.message);
  } else {
    const t = unwrapText(create.result);
    const parsed = JSON.parse(t) as { created?: { id: number }; dive?: unknown };
    if (parsed.created?.id) {
      createdId = parsed.created.id;
      pass('padi_create_dive', `id=${createdId}`);
    } else fail('padi_create_dive', t.slice(0, 200));
  }

  if (createdId != null) {
    // padi_get_dive
    const get = await rpc('tools/call', {
      name: 'padi_get_dive',
      arguments: { diveId: createdId },
    });
    if (get.error) fail('padi_get_dive', get.error.message);
    else {
      const t = unwrapText(get.result);
      const parsed = JSON.parse(t) as {
        dive_title?: string;
        equipment?: { additional_equipment?: string[] | null };
      };
      const titleOk = parsed.dive_title === sandboxTitle;
      const ae = parsed.equipment?.additional_equipment;
      const aeOk = JSON.stringify(ae) === JSON.stringify(['Camera', 'Compass']);
      if (titleOk && aeOk) pass('padi_get_dive', 'title + additional_equipment round-trip ok');
      else fail('padi_get_dive', `titleOk=${titleOk} aeOk=${aeOk} (ae=${JSON.stringify(ae)})`);
    }

    // padi_update_dive
    const upd = await rpc('tools/call', {
      name: 'padi_update_dive',
      arguments: {
        diveId: createdId,
        max_depth: 18,
        notes: 'mcp-smoke\nupdated',
        additional_equipment: ['Reel'],
      },
    });
    if (upd.error) fail('padi_update_dive', upd.error.message);
    else {
      const t = unwrapText(upd.result);
      const parsed = JSON.parse(t) as {
        dive?: {
          depth_time?: { max_depth?: number };
          equipment?: { additional_equipment?: string[] | null };
        };
      };
      const depthOk = parsed.dive?.depth_time?.max_depth === 18;
      const aeOk =
        JSON.stringify(parsed.dive?.equipment?.additional_equipment) === JSON.stringify(['Reel']);
      if (depthOk && aeOk) pass('padi_update_dive', 'depth + array patch ok');
      else fail('padi_update_dive', `depthOk=${depthOk} aeOk=${aeOk}`);
    }

    // padi_delete_dive — sandbox-guarded, must include confirm: true
    const del = await rpc('tools/call', {
      name: 'padi_delete_dive',
      arguments: { diveId: createdId, confirm: true },
    });
    if (del.error) fail('padi_delete_dive', del.error.message);
    else {
      const t = unwrapText(del.result);
      const parsed = JSON.parse(t) as { deleted?: number; strategy?: string; error?: string };
      if (parsed.deleted === createdId) pass('padi_delete_dive', `strategy=${parsed.strategy}`);
      else fail('padi_delete_dive', t.slice(0, 200));
    }

    // padi_delete_dive sandbox-guard rejection: try without confirm on a fake
    // real-looking id. We can't easily test this without a real dive, so just
    // verify the guard rejects a recent real dive without override.
  }

  // 12. Sandbox guard rejection — pick a real recent dive, attempt delete,
  // expect a sandbox-guard error (NOT actual deletion).
  const recentList = await rpc('tools/call', {
    name: 'padi_list_dives',
    arguments: { limit: 1 },
  });
  if (!recentList.error) {
    const arr = JSON.parse(unwrapText(recentList.result)) as Array<{
      id: number;
      dive_title: string;
    }>;
    if (arr[0] && !arr[0].dive_title.startsWith('MCPTEST_')) {
      const guardTest = await rpc('tools/call', {
        name: 'padi_delete_dive',
        arguments: { diveId: arr[0].id, confirm: true },
      });
      if (guardTest.error) fail('sandbox-guard', guardTest.error.message);
      else {
        const t = unwrapText(guardTest.result);
        if (t.includes('sandbox-guard')) pass('sandbox-guard', 'refused real dive');
        else fail('sandbox-guard', `expected refusal, got: ${t.slice(0, 150)}`);
      }
    } else {
      console.error('(skip sandbox-guard test — no real dive at top of list)');
    }
  }

  // Done.
  child.stdin.end();
  child.kill();
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.error(`\nSummary: ${passed}/${checks.length} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke-test fatal:', e);
  child.kill();
  process.exit(1);
});
