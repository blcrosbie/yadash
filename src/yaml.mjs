// A deliberately small YAML reader for the yadash dialect.
//
// Why not a YAML library? Two reasons that matter more than completeness:
//   1. zero install - `node bin/yadash.mjs` has to work in a cold clone, on any
//      machine, with no network. Adoption dies at `npm install`.
//   2. a small surface is a feature. Anchors, aliases, tags and multi-doc files
//      are exactly the constructs that make an LLM-edited config unreviewable.
//
// Supported: block maps, block sequences, flow `[a, b]` / `{a: 1}`, quoted and
// plain scalars, `|` and `>` block scalars, comments, null/bool/number literals.
// Anything else raises a YamlError pointing at the line.

const LOC = new WeakMap();

export class YamlError extends Error {
  constructor(message, line, column = 0) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
    this.column = column;
  }
}

/** Line number where `key` was written (or where the node itself started). */
export function lineOf(node, key) {
  const loc = node && typeof node === 'object' ? LOC.get(node) : null;
  if (!loc) return null;
  if (key === undefined) return loc.$self ?? null;
  return loc[key] ?? loc.$self ?? null;
}

export function parse(source) {
  const lines = scan(source);
  if (lines.length === 0) return null;
  const ctx = { lines, i: 0, raw: source.replace(/^﻿/, '').split(/\r?\n/) };
  const value = parseBlock(ctx, lines[0].indent);
  if (ctx.i < lines.length) {
    throw new YamlError('unexpected content - check the indentation', lines[ctx.i].n);
  }
  return value;
}

function scan(source) {
  const out = [];
  const raw = source.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    const n = i + 1;
    if (/^\s*$/.test(line)) continue;
    if (/^\t/.test(line) || /^ *\t/.test(line)) {
      throw new YamlError('tabs are not valid YAML indentation - use spaces', n);
    }
    if (/^---\s*$/.test(line) || /^\.\.\.\s*$/.test(line)) continue;
    const text = stripComment(line).replace(/\s+$/, '');
    if (text.trim() === '') continue;
    const indent = text.length - text.trimStart().length;
    out.push({ n, indent, raw: line, text: text.trimStart() });
  }
  return out;
}

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\' && quote === '"') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseBlock(ctx, indent) {
  const first = ctx.lines[ctx.i];
  if (first.text === '-' || first.text.startsWith('- ')) return parseSeq(ctx, indent);
  return parseMap(ctx, indent);
}

function parseMap(ctx, indent) {
  const obj = {};
  const loc = { $self: ctx.lines[ctx.i].n };
  while (ctx.i < ctx.lines.length) {
    const ln = ctx.lines[ctx.i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) {
      throw new YamlError('this line is indented further than the one above it', ln.n);
    }
    if (ln.text.startsWith('- ')) break;
    const split = splitKey(ln.text);
    if (!split) {
      throw new YamlError(`expected "key: value" but found: ${ln.text}`, ln.n);
    }
    if (Object.prototype.hasOwnProperty.call(obj, split.key)) {
      throw new YamlError(`duplicate key "${split.key}"`, ln.n);
    }
    loc[split.key] = ln.n;
    ctx.i++;
    obj[split.key] = parseValue(ctx, ln, split.rest, indent);
  }
  LOC.set(obj, loc);
  return obj;
}

function parseSeq(ctx, indent) {
  const arr = [];
  const loc = { $self: ctx.lines[ctx.i].n };
  while (ctx.i < ctx.lines.length) {
    const ln = ctx.lines[ctx.i];
    if (ln.indent < indent) break;
    if (ln.indent > indent) {
      throw new YamlError('this list item is indented further than the one above it', ln.n);
    }
    if (ln.text !== '-' && !ln.text.startsWith('- ')) break;
    loc[arr.length] = ln.n;
    const after = ln.text.slice(1);
    const rest = after.trimStart();
    const childIndent = ln.indent + 1 + (after.length - rest.length);
    ctx.i++;
    if (rest === '') {
      const next = ctx.lines[ctx.i];
      arr.push(next && next.indent > ln.indent ? parseBlock(ctx, next.indent) : null);
    } else if (looksLikeKey(rest)) {
      // `- key: value` starts a map whose first key sits at childIndent.
      ctx.lines[ctx.i - 1] = { n: ln.n, indent: childIndent, raw: ln.raw, text: rest };
      ctx.i--;
      arr.push(parseMap(ctx, childIndent));
    } else if (rest === '|' || rest === '>' || /^[|>][-+]?$/.test(rest)) {
      arr.push(readBlockScalar(ctx, rest, ln.indent));
    } else {
      arr.push(parseFlow(rest, ln.n));
    }
  }
  LOC.set(arr, loc);
  return arr;
}

function parseValue(ctx, ln, rest, indent) {
  if (rest === '') {
    const next = ctx.lines[ctx.i];
    if (next && next.indent > indent) return parseBlock(ctx, next.indent);
    return null;
  }
  if (/^[|>][-+]?$/.test(rest)) return readBlockScalar(ctx, rest, indent);
  return parseFlow(rest, ln.n);
}

function readBlockScalar(ctx, marker, indent) {
  const fold = marker[0] === '>';
  const chomp = marker[1] || '';
  // Blank lines were dropped by scan(), but a markdown paragraph break is
  // meaningful here - so replay the original source between the first and last
  // line that belong to this scalar.
  let j = ctx.i;
  let baseIndent = null;
  while (j < ctx.lines.length && ctx.lines[j].indent > indent) {
    if (baseIndent === null) baseIndent = ctx.lines[j].indent;
    j++;
  }
  if (baseIndent === null) return '';
  const startN = ctx.lines[ctx.i].n;
  const endN = ctx.lines[j - 1].n;
  ctx.i = j;
  const collected = [];
  for (let k = startN; k <= endN; k++) {
    const raw = (ctx.raw[k - 1] ?? '').replace(/\s+$/, '');
    collected.push(raw.length >= baseIndent ? raw.slice(baseIndent) : raw.trimStart());
  }
  let text = fold
    ? collected.reduce((acc, l) => (l === '' ? acc + '\n\n' : acc === '' || acc.endsWith('\n') ? acc + l : acc + ' ' + l), '')
    : collected.join('\n');
  if (chomp !== '+') text = text.replace(/\n+$/, '');
  if (chomp === '+') text += '\n';
  return text;
}

const KEY_RE = /^(?:[A-Za-z_][\w.\-/]*|"(?:[^"\\]|\\.)*"|'[^']*')\s*:(?:\s|$)/;

function looksLikeKey(text) {
  if (text.startsWith('[') || text.startsWith('{')) return false;
  return KEY_RE.test(text);
}

function splitKey(text) {
  const m = KEY_RE.exec(text);
  if (!m) return null;
  let key = m[0].replace(/\s*:\s*$/, '').trim();
  key = key.replace(/:$/, '').trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return { key, rest: text.slice(m[0].length).trim() };
}

function parseFlow(text, line) {
  const s = text.trim();
  if (s === '') return null;
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new YamlError('unclosed "[" - flow lists must fit on one line', line);
    return splitTopLevel(s.slice(1, -1), line).map((part) => parseFlow(part, line));
  }
  if (s.startsWith('{')) {
    if (!s.endsWith('}')) throw new YamlError('unclosed "{" - flow maps must fit on one line', line);
    const obj = {};
    const loc = { $self: line };
    for (const part of splitTopLevel(s.slice(1, -1), line)) {
      const split = splitKey(part.trim());
      if (!split) throw new YamlError(`expected "key: value" inside { }: ${part}`, line);
      obj[split.key] = parseFlow(split.rest, line);
      loc[split.key] = line;
    }
    LOC.set(obj, loc);
    return obj;
  }
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError('unclosed double quote', line);
    return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError('unclosed single quote', line);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null;
  if (s === 'true' || s === 'True' || s === 'TRUE' || s === 'yes') return true;
  if (s === 'false' || s === 'False' || s === 'FALSE' || s === 'no') return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s)) return Number(s);
  if (s === '&' || s.startsWith('&') || s.startsWith('*')) {
    throw new YamlError('anchors and aliases are not supported in yadash YAML', line);
  }
  return s;
}

function splitTopLevel(text, line) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && quote === '"') {
        current += text[++i] ?? '';
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '[' || ch === '{') depth++;
    if (ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += ch;
  }
  if (depth !== 0) throw new YamlError('unbalanced brackets in flow value', line);
  if (current.trim() !== '' || parts.length > 0) parts.push(current);
  return parts.map((p) => p.trim()).filter((p, idx, all) => !(p === '' && all.length === 1));
}
