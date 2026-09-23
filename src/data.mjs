// Build-time data loading. Anything we can read at build time we also type
// check against the YAML, which is how "field doesn't exist" becomes a compile
// error instead of an empty chart nobody notices for three weeks.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function loadSources(doc, entryPath) {
  const base = dirname(resolve(entryPath));
  const data = doc?.dashboard?.data || {};
  const loaded = {};
  const fields = {};
  const errors = [];

  for (const [name, src] of Object.entries(data)) {
    try {
      if (src.type === 'inline') {
        loaded[name] = coerce(src.rows || [], src);
      } else if (src.type === 'csv' && src.path) {
        loaded[name] = coerce(parseCsv(readFileSync(resolve(base, src.path), 'utf8')), src);
      } else if (src.type === 'json' && src.path) {
        const raw = JSON.parse(readFileSync(resolve(base, src.path), 'utf8'));
        loaded[name] = coerce(pluck(raw, src.root), src);
      } else {
        loaded[name] = null; // api: resolved in the browser
      }
    } catch (err) {
      errors.push({ source: name, message: err.message });
      loaded[name] = null;
    }
    if (loaded[name]) fields[name] = fieldsOf(loaded[name]);
  }
  return { rows: loaded, fields, errors };
}

function pluck(value, root) {
  if (!root) return Array.isArray(value) ? value : [];
  let cur = value;
  for (const part of root.split('.')) cur = cur?.[part];
  return Array.isArray(cur) ? cur : [];
}

export function fieldsOf(rows) {
  const set = new Set();
  for (const row of rows.slice(0, 200)) {
    for (const key of Object.keys(row || {})) set.add(key);
  }
  return [...set];
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => String(v).trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? null])));
}

export function coerce(rows, src = {}) {
  const dateFields = new Set(src.date_fields || []);
  const numberFields = new Set(src.number_fields || []);
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row || {})) {
      out[k] = coerceValue(v, dateFields.has(k), numberFields.has(k));
    }
    return out;
  });
}

function coerceValue(value, isDate, isNumber) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return null;
  if (isDate) return s;
  if (isNumber) {
    const n = Number(s.replace(/[$,\s%]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return Number(s);
  if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
  return s;
}
