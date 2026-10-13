import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, cleanRecords, summarize } from '../src/clean.js';
import { simulate } from '../src/simulate-account-usage.js';
import { CSV } from './helpers.js';

const raw = parseCsv(CSV);
const result = cleanRecords(raw);

test('cleaning keeps every record and finds the injected defects', () => {
  const s = summarize(raw, result);
  assert.equal(s.input_rows, 2000);
  assert.equal(s.clean_rows, 2000);
  assert.equal(s.unique_report_ids, 100);
  assert.equal(s.orphaned, 245);
  assert.equal(s.orphan_missing_owner, 128);
  assert.equal(s.orphan_literal, 117);
  assert.equal(s.negative_credit_rows, 24);
  assert.equal(s.latency_critical, 910);
  assert.equal(s.latency_warning, 580);
  assert.equal(s.issues_total, 2053);
});

test('CSV parser handles quotes, escaped quotes and CRLF', () => {
  const rows = parseCsv('a,b\r\n"x,1","say ""hi"""\r\n2,3\r\n');
  assert.deepEqual(rows, [{ a: 'x,1', b: 'say "hi"' }, { a: '2', b: '3' }]);
});

test('simulation is deterministic and reconciles to the CSV', () => {
  const a = simulate(result.clean);
  const b = simulate(result.clean);
  assert.deepEqual(a.queries.slice(0, 20), b.queries.slice(0, 20));
  assert.equal(a.queries.length, 9880);
  assert.equal(a.metering.length, 518);
  assert.equal(a.metering.filter((m) => m.credits_used < 0).length, 24);
  const valid = a.metering.filter((m) => m.credits_used >= 0).reduce((s, m) => s + m.credits_used, 0);
  assert.ok(Math.abs(valid - 1206352.48) < 0.01);
});
