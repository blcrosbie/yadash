// Validation is the whole safety story of yadash: an agent may edit the YAML
// freely, but nothing reaches the renderer until it survives this pass. Errors
// carry a line number and, where possible, a suggestion - that is what turns a
// failed build into a one-shot fix instead of a guessing game.

import { lineOf } from './yaml.mjs';

export function validate(doc, schema, options = {}) {
  const issues = [];
  checkSchema(doc, schema, schema, '$', null, null, issues);
  if (issues.some((i) => i.level === 'error')) return sort(issues);
  lint(doc, issues, options);
  return sort(issues);
}

function sort(issues) {
  return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

function add(issues, level, path, line, message, hint) {
  issues.push({ level, path, line: line ?? null, message, hint: hint ?? null });
}

/* ------------------------------------------------------------------ schema */

function deref(schema, root) {
  let s = schema;
  let guard = 0;
  while (s && s.$ref && guard++ < 20) {
    const parts = s.$ref.replace(/^#\//, '').split('/');
    let target = root;
    for (const p of parts) target = target?.[p];
    s = target;
  }
  return s || {};
}

function checkSchema(value, schemaIn, root, path, parent, key, issues) {
  const schema = deref(schemaIn, root);
  const line = lineFor(parent, key, value);

  if ('const' in schema && value !== schema.const) {
    add(issues, 'error', path, line, `must be ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    add(
      issues,
      'error',
      path,
      line,
      `${JSON.stringify(value)} is not allowed here`,
      `allowed: ${schema.enum.join(', ')}${suggestion(String(value), schema.enum)}`
    );
    return;
  }
  if (schema.type && !typeOk(value, schema.type)) {
    add(issues, 'error', path, line, `expected ${schema.type}, found ${typeName(value)}`);
    return;
  }

  if (schema.type === 'string' || typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      add(issues, 'error', path, line, `"${value}" does not match the required format`, patternHint(schema.pattern));
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      add(issues, 'error', path, line, `must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      add(issues, 'error', path, line, `must be <= ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      add(issues, 'error', path, line, `needs at least ${schema.minItems} item(s)`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      add(issues, 'error', path, line, `accepts at most ${schema.maxItems} item(s)`);
    }
    value.forEach((item, idx) => {
      const itemSchema = schema.prefixItems?.[idx] ?? schema.items;
      if (itemSchema) checkSchema(item, itemSchema, root, `${path}[${idx}]`, value, idx, issues);
    });
    return;
  }

  if (isPlainObject(value)) {
    for (const req of schema.required || []) {
      if (!(req in value)) {
        add(issues, 'error', `${path}.${req}`, line, `missing required key "${req}"`);
      }
    }
    if (schema.minProperties && Object.keys(value).length < schema.minProperties) {
      add(issues, 'error', path, line, `needs at least ${schema.minProperties} entr(ies)`);
    }
    const known = Object.keys(schema.properties || {});
    for (const [k, v] of Object.entries(value)) {
      const propSchema =
        schema.properties?.[k] ??
        matchPattern(schema.patternProperties, k) ??
        (schema.additionalProperties && schema.additionalProperties !== true ? schema.additionalProperties : null);
      if (!propSchema) {
        if (schema.additionalProperties === false) {
          const where = known.length
            ? `valid keys here: ${known.join(', ')}${suggestion(k, known)}`
            : namingHint(schema.patternProperties);
          add(issues, 'error', `${path}.${k}`, lineFor(value, k, v), `unknown key "${k}"`, where);
        }
        continue;
      }
      checkSchema(v, propSchema, root, `${path}.${k}`, value, k, issues);
    }
  }
}

function matchPattern(patternProperties, key) {
  if (!patternProperties) return null;
  for (const [pattern, sub] of Object.entries(patternProperties)) {
    if (new RegExp(pattern).test(key)) return sub;
  }
  return null;
}

function namingHint(patternProperties) {
  if (!patternProperties) return null;
  const p = Object.keys(patternProperties)[0];
  if (p === '^[a-z][a-z0-9_]*$') return 'names must be lower_snake_case and start with a letter';
  return `names must match ${p}`;
}

function patternHint(pattern) {
  if (pattern === '^[a-z0-9][a-z0-9-]*$') return 'use a lowercase slug, e.g. sales-health';
  if (pattern === '^[a-z][a-z0-9_]*$') return 'use lower_snake_case, e.g. show_rate';
  if (pattern === '^#[0-9a-fA-F]{6}$') return 'use a 6-digit hex colour, e.g. #4f8cff';
  return `expected pattern ${pattern}`;
}

function typeOk(value, type) {
  switch (type) {
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'number': return typeof value === 'number';
    case 'integer': return Number.isInteger(value);
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function typeName(value) {
  if (value === null) return 'nothing';
  if (Array.isArray(value)) return 'a list';
  if (isPlainObject(value)) return 'a map';
  return `a ${typeof value}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function lineFor(parent, key, value) {
  const direct = parent && key !== null && key !== undefined ? lineOf(parent, key) : null;
  return direct ?? (value && typeof value === 'object' ? lineOf(value) : null) ?? (parent ? lineOf(parent) : null);
}

/* -------------------------------------------------------------------- lint */

const WIDGET_RULES = {
  kpi: { needs: ['metric'], allows: ['compare', 'target', 'thresholds', 'format'] },
  line: { needs: ['x', 'y'] },
  area: { needs: ['x', 'y'] },
  bar: { needs: ['x', 'y'] },
  stacked_bar: { needs: ['x', 'y'] },
  scatter: { needs: ['x', 'y'] },
  hbar: { needs: ['dimension', 'metric|metrics'] },
  pie: { needs: ['dimension', 'metric'] },
  donut: { needs: ['dimension', 'metric'] },
  table: { needs: ['dimensions|columns'] },
  markdown: { needs: ['text'] },
};

export function lint(doc, issues, options = {}) {
  const dash = doc?.dashboard;
  if (!isPlainObject(dash)) return;
  const sources = Object.keys(dash.data || {});
  const metrics = dash.metrics || {};
  const metricNames = Object.keys(metrics);
  const fields = options.fields || {}; // { sourceName: [field, ...] }
  const defaultSource = sources[0];

  const needSource = (name, parent, key, path) => {
    if (name === undefined || name === null) return;
    if (!sources.includes(name)) {
      add(issues, 'error', path, lineFor(parent, key, name), `unknown data source "${name}"`,
        sources.length ? `defined sources: ${sources.join(', ')}${suggestion(name, sources)}` : 'no data sources are defined');
    }
  };
  const needMetric = (name, parent, key, path) => {
    if (typeof name !== 'string') return;
    if (!metricNames.includes(name)) {
      add(issues, 'error', path, lineFor(parent, key, name), `unknown metric "${name}"`,
        metricNames.length
          ? `defined metrics: ${metricNames.join(', ')}${suggestion(name, metricNames)}`
          : 'define it under dashboard.metrics first');
    }
  };
  const needField = (sourceName, field, parent, key, path) => {
    if (typeof field !== 'string') return;
    const src = sourceName || defaultSource;
    const known = fields[src];
    if (!known || known.length === 0) return; // data not readable at build time
    if (!known.includes(field)) {
      add(issues, 'warning', path, lineFor(parent, key, field), `field "${field}" is not in data source "${src}"`,
        `available: ${known.slice(0, 12).join(', ')}${known.length > 12 ? ', ...' : ''}${suggestion(field, known)}`);
    }
  };

  // data sources
  for (const [name, src] of Object.entries(dash.data || {})) {
    const path = `$.dashboard.data.${name}`;
    if (src.type === 'inline' && !Array.isArray(src.rows)) {
      add(issues, 'error', path, lineFor(dash.data, name, src), 'inline sources need a "rows" list');
    }
    if ((src.type === 'csv' || src.type === 'json') && !src.path) {
      add(issues, 'error', path, lineFor(dash.data, name, src), `${src.type} sources need a "path"`);
    }
    if (src.type === 'api' && !src.url) {
      add(issues, 'error', path, lineFor(dash.data, name, src), 'api sources need a "url"');
    }
    if (src.type !== 'api' && (src.url || src.headers || src.refresh)) {
      add(issues, 'warning', path, lineFor(dash.data, name, src), `url/headers/refresh only apply to type: api`);
    }
    if (src.headers && Object.values(src.headers).some((v) => /bearer |api[_-]?key|secret|token/i.test(String(v)))) {
      add(issues, 'warning', `${path}.headers`, lineFor(src, 'headers'), 'this looks like a credential',
        'compiled dashboards are public files - put auth behind your API, not in the YAML');
    }
  }

  // metrics
  for (const [name, m] of Object.entries(metrics)) {
    const path = `$.dashboard.metrics.${name}`;
    needSource(m.source, m, 'source', `${path}.source`);
    if (m.agg !== 'count' && !m.field) {
      add(issues, 'error', path, lineFor(metrics, name, m), `agg: ${m.agg} needs a "field"`);
    }
    if (m.agg === 'ratio' && !m.of) {
      add(issues, 'error', path, lineFor(metrics, name, m), 'agg: ratio needs "of" (the denominator field)');
    }
    if (m.field) needField(m.source, m.field, m, 'field', `${path}.field`);
    if (m.of) needField(m.source, m.of, m, 'of', `${path}.of`);
    for (const cond of m.where || []) needField(m.source, cond.field, cond, 'field', `${path}.where`);
  }

  // filters
  (dash.filters || []).forEach((f, i) => {
    const path = `$.dashboard.filters[${i}]`;
    needSource(f.source, f, 'source', `${path}.source`);
    needField(f.source, f.field, f, 'field', `${path}.field`);
  });

  // widgets
  const columns = dash.layout?.columns ?? 12;
  const seenIds = new Map();
  const cells = [];
  (dash.widgets || []).forEach((w, i) => {
    const path = `$.dashboard.widgets[${i}]`;
    const wline = lineFor(dash.widgets, i, w);
    if (w.id) {
      if (seenIds.has(w.id)) {
        add(issues, 'error', `${path}.id`, lineFor(w, 'id'), `duplicate widget id "${w.id}"`,
          `also used on line ${seenIds.get(w.id)} - ids are how you and the agent refer to a widget`);
      }
      seenIds.set(w.id, lineFor(w, 'id'));
    }
    needSource(w.source, w, 'source', `${path}.source`);

    const rules = WIDGET_RULES[w.type];
    if (rules) {
      for (const need of rules.needs) {
        const alternatives = need.split('|');
        if (!alternatives.some((k) => w[k] !== undefined && w[k] !== null)) {
          add(issues, 'error', path, wline, `a "${w.type}" widget needs ${alternatives.join(' or ')}`,
            widgetHint(w.type));
        }
      }
    }

    needMetric(w.metric, w, 'metric', `${path}.metric`);
    (w.metrics || []).forEach((m, j) => needMetric(m, w.metrics, j, `${path}.metrics[${j}]`));
    for (const axisKey of ['x', 'y']) {
      const axis = w[axisKey];
      if (!isPlainObject(axis)) continue;
      needMetric(axis.metric, axis, 'metric', `${path}.${axisKey}.metric`);
      (axis.metrics || []).forEach((m, j) => needMetric(m, axis.metrics, j, `${path}.${axisKey}.metrics[${j}]`));
      if (axis.field) needField(w.source, axis.field, axis, 'field', `${path}.${axisKey}.field`);
      if (axis.metric === undefined && axis.metrics === undefined && axis.field === undefined) {
        add(issues, 'error', `${path}.${axisKey}`, lineFor(w, axisKey, axis), `${axisKey} needs a "field" or a "metric"`);
      }
    }
    if (w.dimension?.field) needField(w.source, w.dimension.field, w.dimension, 'field', `${path}.dimension.field`);
    (w.dimensions || []).forEach((d, j) => {
      if (d?.field) needField(w.source, d.field, d, 'field', `${path}.dimensions[${j}].field`);
    });
    if (w.series?.field) needField(w.source, w.series.field, w.series, 'field', `${path}.series.field`);
    for (const cond of w.where || []) needField(w.source, cond.field, cond, 'field', `${path}.where`);

    if (w.sort?.by) {
      const known = [
        ...metricNames,
        ...(w.dimensions || []).map((d) => d?.field),
        w.dimension?.field,
        w.x?.field,
      ].filter(Boolean);
      if (!known.includes(w.sort.by)) {
        add(issues, 'error', `${path}.sort.by`, lineFor(w.sort, 'by'), `cannot sort by "${w.sort.by}"`,
          `sort by a metric or a dimension used in this widget: ${known.join(', ')}${suggestion(w.sort.by, known)}`);
      }
    }

    (w.columns || []).forEach((c, j) => {
      const known = [...metricNames, ...(w.dimensions || []).map((d) => d?.field).filter(Boolean)];
      if (c?.key && !known.includes(c.key)) {
        add(issues, 'error', `${path}.columns[${j}].key`, lineFor(c, 'key'), `column "${c.key}" is neither a metric nor one of this table's dimensions`,
          `available: ${known.join(', ')}${suggestion(c.key, known)}`);
      }
    });

    for (const t of w.thresholds || []) {
      if (t.below === undefined && t.above === undefined) {
        add(issues, 'error', `${path}.thresholds`, lineFor(t), 'a threshold needs "below" or "above"');
      }
    }

    // layout
    const [col, row] = w.position || [null, null];
    const [width, height] = w.size || [null, null];
    if (col && width && col + width - 1 > columns) {
      add(issues, 'error', `${path}.position`, lineFor(w, 'position'),
        `widget runs off the grid: starts at column ${col} and is ${width} wide, but the grid is ${columns} columns`,
        `use position: [${Math.max(1, columns - width + 1)}, ${row ?? 1}] or make it narrower`);
    }
    if (col && row && width && height) {
      cells.push({ id: w.id || `widget[${i}]`, line: wline, col, row, width, height, path });
    }
  });

  for (let a = 0; a < cells.length; a++) {
    for (let b = a + 1; b < cells.length; b++) {
      if (overlaps(cells[a], cells[b])) {
        add(issues, 'warning', cells[b].path, cells[b].line,
          `"${cells[b].id}" overlaps "${cells[a].id}"`,
          'widgets stack in the same grid cells - adjust position/size so each has its own space');
      }
    }
  }
}

function overlaps(a, b) {
  return (
    a.col < b.col + b.width && b.col < a.col + a.width &&
    a.row < b.row + b.height && b.row < a.row + a.height
  );
}

function widgetHint(type) {
  const hints = {
    kpi: 'e.g. metric: show_rate',
    line: 'e.g. x: { field: engagement_date, bucket: day }  y: { metric: meeting_count }',
    area: 'e.g. x: { field: date, bucket: week }  y: { metric: revenue }',
    bar: 'e.g. x: { field: stage }  y: { metric: deal_count }',
    stacked_bar: 'e.g. x: { field: month, bucket: month }  y: { metric: revenue }  series: { field: region }',
    scatter: 'e.g. x: { metric: spend }  y: { metric: revenue }  series: { field: campaign }',
    hbar: 'e.g. dimension: { field: rep, limit: 10 }  metric: meeting_count',
    pie: 'e.g. dimension: { field: source }  metric: lead_count',
    donut: 'e.g. dimension: { field: source }  metric: lead_count',
    table: 'e.g. dimensions: [{ field: rep }]  metrics: [meeting_count, show_rate]',
    markdown: 'e.g. text: "## Notes"',
  };
  return hints[type] || null;
}

/* -------------------------------------------------------------- suggestions */

function suggestion(value, candidates) {
  const best = closest(value, candidates);
  return best ? ` (did you mean "${best}"?)` : '';
}

export function closest(value, candidates) {
  let best = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const score = distance(String(value).toLowerCase(), String(c).toLowerCase());
    if (score < bestScore) { bestScore = score; best = c; }
  }
  const limit = Math.max(2, Math.floor(String(value).length / 3));
  return bestScore <= limit ? best : null;
}

function distance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, i) => i);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    for (let j = 1; j < cols; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[cols - 1];
}
