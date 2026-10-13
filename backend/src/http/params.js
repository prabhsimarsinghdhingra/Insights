// Query-string parsing and pagination helpers. All user input is validated
// here, against whitelists, before it reaches the data layer.

import { badRequest } from '../errors.js';

// Express can hand us arrays/objects for repeated or nested params.
function one(value, name) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw badRequest(`${name} must be a single value`);
  return value;
}

function intParam(value, fallback, name, min, max) {
  const v = one(value, name);
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

export function parsePaging(query, { defaultSize = 25, maxSize = 100 } = {}) {
  return {
    page: intParam(query.page, 1, 'page', 1, 1_000_000),
    pageSize: intParam(query.page_size, defaultSize, 'page_size', 1, maxSize),
  };
}

export function parseSort(query, allowed, fallback) {
  const sort = one(query.sort, 'sort') ?? fallback.sort;
  const order = (one(query.order, 'order') ?? fallback.order).toLowerCase();
  if (!allowed.includes(sort)) throw badRequest(`sort must be one of: ${allowed.join(', ')}`);
  if (order !== 'asc' && order !== 'desc') throw badRequest('order must be asc or desc');
  return { sort, order };
}

export function parseBool(value, name) {
  const v = one(value, name);
  if (v === undefined || v === '') return undefined;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw badRequest(`${name} must be true or false`);
}

export function parseEnum(value, name, allowed) {
  const v = one(value, name);
  if (v === undefined || v === '') return undefined;
  if (!allowed.includes(v)) throw badRequest(`${name} must be one of: ${allowed.join(', ')}`);
  return v;
}

export function parseText(value, name, maxLen = 100) {
  const v = one(value, name);
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t.length > maxLen) throw badRequest(`${name} must be at most ${maxLen} characters`);
  return t === '' ? undefined : t;
}

export function paginate(rows, { page, pageSize }) {
  return {
    data: rows.slice((page - 1) * pageSize, page * pageSize),
    page,
    page_size: pageSize,
    total: rows.length,
    total_pages: Math.max(1, Math.ceil(rows.length / pageSize)),
  };
}

// Stable sort, nulls last, with a deterministic tiebreaker.
export function sortRows(rows, sort, order, tiebreak = 'report_id') {
  const dir = order === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort];
    const y = b[sort];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (x < y) return -1 * dir;
    if (x > y) return 1 * dir;
    return a[tiebreak] < b[tiebreak] ? -1 : a[tiebreak] > b[tiebreak] ? 1 : 0;
  });
}
