// Compile a dashboard.yaml into a self-contained static page.
//
// The output is deliberately boring: one HTML file (plus a data file when the
// data is large). No build server, no runtime dependency beyond one CDN script
// you can self-host. That is what makes "drop it on WordPress / Pages / S3"
// true rather than aspirational.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, YamlError } from './yaml.mjs';
import { validate } from './validate.mjs';
import { loadSources } from './data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const SCHEMA_PATH = join(ROOT, 'schema', 'dashboard.schema.json');
export const DEFAULT_ECHARTS = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js';
const EMBED_LIMIT = 1_500_000; // bytes of JSON before we split the data out

export class BuildError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.name = 'BuildError';
    this.issues = issues;
  }
}

export function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

/** Parse + validate only. Returns { doc, issues, data }. Never throws on invalid YAML. */
export function check(entryPath) {
  const text = readFileSync(entryPath, 'utf8');
  let doc;
  try {
    doc = parse(text);
  } catch (err) {
    if (err instanceof YamlError) {
      return { doc: null, data: null, issues: [{ level: 'error', path: '$', line: err.line, message: err.message, hint: null }] };
    }
    throw err;
  }
  if (doc === null || typeof doc !== 'object') {
    return { doc: null, data: null, issues: [{ level: 'error', path: '$', line: 1, message: 'this file is empty or is not a YAML mapping', hint: null }] };
  }
  const data = loadSources(doc, entryPath);
  const issues = validate(doc, loadSchema(), { fields: data.fields });
  for (const e of data.errors) {
    issues.push({ level: 'error', path: `$.dashboard.data.${e.source}`, line: null, message: `could not read data source "${e.source}": ${e.message}`, hint: null });
  }
  return { doc, data, issues };
}

export function compile(entryPath, options = {}) {
  const { doc, data, issues } = check(entryPath);
  const errors = issues.filter((i) => i.level === 'error');
  if (errors.length) throw new BuildError(`${errors.length} error(s) in ${basename(entryPath)}`, issues);

  const dash = doc.dashboard;
  const outDir = resolve(options.outDir || join(dirname(resolve(entryPath)), 'dist'));
  mkdirSync(outDir, { recursive: true });

  const spec = {
    id: dash.id,
    title: dash.title,
    description: dash.description || null,
    theme: dash.theme || 'auto',
    accent: dash.accent || null,
    layout: {
      columns: dash.layout?.columns ?? 12,
      gap: dash.layout?.gap ?? 16,
      row_height: dash.layout?.row_height ?? 64,
      max_width: dash.layout?.max_width ?? 1400,
    },
    metrics: dash.metrics || {},
    filters: normalizeFilters(dash.filters || []),
    widgets: normalizeWidgets(dash.widgets || [], dash.layout?.columns ?? 12),
    data: {},
    embed: !!options.embed,
    sourceFile: basename(entryPath),
    builtAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
  };

  const written = [];
  for (const [name, src] of Object.entries(dash.data || {})) {
    if (src.type === 'api') {
      spec.data[name] = {
        url: src.url,
        root: src.root || null,
        headers: src.headers || null,
        refresh: src.refresh || null,
      };
      continue;
    }
    const rows = data.rows[name] || [];
    const json = JSON.stringify(rows);
    if (json.length > EMBED_LIMIT) {
      const rel = `data/${name}.json`;
      mkdirSync(join(outDir, 'data'), { recursive: true });
      writeFileSync(join(outDir, rel), json);
      written.push(rel);
      spec.data[name] = { file: (options.base || '') + rel };
    } else {
      spec.data[name] = { rows };
    }
  }

  const echartsSrc = options.echarts || DEFAULT_ECHARTS;
  let echartsTag = `<script src="${escapeAttr(echartsSrc)}"></script>`;
  if (options.vendorEcharts && existsSync(options.vendorEcharts)) {
    mkdirSync(join(outDir, 'assets'), { recursive: true });
    copyFileSync(options.vendorEcharts, join(outDir, 'assets', 'echarts.min.js'));
    written.push('assets/echarts.min.js');
    echartsTag = `<script src="${(options.base || '')}assets/echarts.min.js"></script>`;
  }

  const css = readFileSync(join(HERE, 'runtime', 'runtime.css'), 'utf8');
  const js = readFileSync(join(HERE, 'runtime', 'runtime.js'), 'utf8');
  const html = page({ spec, css, js, echartsTag });

  const indexPath = join(outDir, 'index.html');
  writeFileSync(indexPath, html);
  written.unshift('index.html');

  if (options.writeSpec !== false) {
    writeFileSync(join(outDir, 'spec.json'), JSON.stringify(spec, null, 2));
    written.push('spec.json');
  }

  return { outDir, files: written, issues, bytes: Buffer.byteLength(html) };
}

function normalizeFilters(filters) {
  return filters.map((f, i) => ({
    id: f.id || f.field.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || `filter_${i}`,
    field: f.field,
    source: f.source || null,
    type: f.type || 'select',
    label: f.label || null,
    default: f.default ?? null,
    options: f.options || null,
  }));
}

function normalizeWidgets(widgets, columns) {
  let cursorRow = 1;
  let cursorCol = 1;
  return widgets.map((w, i) => {
    const out = { ...w };
    out.id = w.id || `w${i + 1}`;
    if (!out.size) out.size = defaultSize(w.type, columns);
    if (!out.position) {
      // Auto-flow: keep authoring optional. Explicit positions always win.
      if (cursorCol + out.size[0] - 1 > columns) { cursorCol = 1; cursorRow += out.size[1]; }
      out.position = [cursorCol, cursorRow];
      cursorCol += out.size[0];
    } else {
      cursorRow = Math.max(cursorRow, out.position[1] + out.size[1]);
      cursorCol = 1;
    }
    return out;
  });
}

function defaultSize(type, columns) {
  switch (type) {
    case 'kpi': return [Math.max(2, Math.round(columns / 4)), 2];
    case 'markdown': return [columns, 2];
    case 'table': return [Math.max(4, Math.round(columns / 2)), 5];
    default: return [Math.max(4, Math.round(columns / 2)), 5];
  }
}

function page({ spec, css, js, echartsTag }) {
  const themeAttr = spec.theme === 'light' || spec.theme === 'dark' ? ` data-theme="${spec.theme}"` : '';
  const accent = spec.accent ? `:root { --yd-s1: ${spec.accent}; }` : '';
  return `<!doctype html>
<html lang="en"${themeAttr}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(spec.title)}</title>
${spec.description ? `<meta name="description" content="${escapeAttr(spec.description)}">` : ''}
<style>
${css}
${accent}
</style>
</head>
<body>
<noscript>This dashboard needs JavaScript to render its charts.</noscript>
${echartsTag}
<script>window.__YADASH_SPEC__ = ${jsonForScript(spec)};</script>
<script>
${js}
</script>
</body>
</html>
`;
}

function jsonForScript(value) {
  // Keep the inline <script> safe: escape anything that could close the tag
  // or break a JS string literal.
  const esc = (code) => '\\u' + code.toString(16).padStart(4, '0');
  return [60, 62, 0x2028, 0x2029].reduce(
    (json, code) => json.split(String.fromCharCode(code)).join(esc(code)),
    JSON.stringify(value)
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function escapeAttr(s) {
  return String(s).replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
