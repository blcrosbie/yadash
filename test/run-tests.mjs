// Tiny zero-dependency test runner. `npm test` or `node test/run-tests.mjs`.
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, lineOf, YamlError } from '../src/yaml.mjs';
import { validate } from '../src/validate.mjs';
import { parseCsv, coerce } from '../src/data.mjs';
import { check, compile, loadSchema, BuildError } from '../src/compile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const schema = loadSchema();

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, err });
  }
}

function tmp(contents, filename = 'dash.yaml') {
  const dir = mkdtempSync(join(tmpdir(), 'yadash-'));
  const file = join(dir, filename);
  writeFileSync(file, contents);
  return { dir, file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const MINIMAL = `version: 1
dashboard:
  id: demo
  title: Demo
  data:
    sales:
      type: inline
      rows:
        - { rep: Ada, amount: 10, day: 2026-01-01 }
        - { rep: Ada, amount: 5, day: 2026-01-02 }
        - { rep: Lin, amount: 7, day: 2026-01-02 }
  metrics:
    revenue:
      agg: sum
      field: amount
      format: currency
  widgets:
    - id: total
      type: kpi
      title: Revenue
      metric: revenue
      position: [1, 1]
      size: [3, 2]
`;

/* ------------------------------------------------------------------- yaml */

test('parses nested maps, lists and flow values', () => {
  const doc = parse(MINIMAL);
  assert.equal(doc.version, 1);
  assert.equal(doc.dashboard.id, 'demo');
  assert.equal(doc.dashboard.data.sales.rows.length, 3);
  assert.equal(doc.dashboard.data.sales.rows[0].rep, 'Ada');
  assert.equal(doc.dashboard.data.sales.rows[0].amount, 10);
  assert.deepEqual(doc.dashboard.widgets[0].position, [1, 1]);
});

test('tracks line numbers for error reporting', () => {
  const doc = parse(MINIMAL);
  assert.equal(lineOf(doc.dashboard, 'title'), 4);
  assert.equal(lineOf(doc.dashboard.widgets[0], 'metric'), 21);
});

test('strips comments but keeps them inside quotes', () => {
  const doc = parse('a: 1 # trailing\nb: "text # not a comment"\n');
  assert.equal(doc.a, 1);
  assert.equal(doc.b, 'text # not a comment');
});

test('reads block scalars including blank lines', () => {
  const doc = parse('text: |\n  line one\n\n  line two\nafter: 2\n');
  assert.equal(doc.text, 'line one\n\nline two');
  assert.equal(doc.after, 2);
});

test('rejects tabs, duplicate keys and anchors with a line number', () => {
  assert.throws(() => parse('a:\n\tb: 1\n'), (e) => e instanceof YamlError && e.line === 2);
  assert.throws(() => parse('a: 1\na: 2\n'), (e) => /duplicate key/.test(e.message));
  assert.throws(() => parse('a: &anchor\n'), (e) => /anchors/.test(e.message));
});

test('parses booleans, nulls and quoted strings', () => {
  const doc = parse("a: true\nb: null\nc: '0012'\nd: 1.5\ne: [x, 2, false]\n");
  assert.equal(doc.a, true);
  assert.equal(doc.b, null);
  assert.equal(doc.c, '0012');
  assert.equal(doc.d, 1.5);
  assert.deepEqual(doc.e, ['x', 2, false]);
});

/* -------------------------------------------------------------- validation */

function issuesFor(yaml, options) {
  return validate(parse(yaml), schema, options);
}

test('accepts a minimal valid dashboard', () => {
  const issues = issuesFor(MINIMAL);
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
});

test('rejects an unknown key and suggests the right one', () => {
  const issues = issuesFor(MINIMAL.replace('  title: Demo', '  titel: Demo'));
  const err = issues.find((i) => /unknown key "titel"/.test(i.message));
  assert.ok(err, 'expected an unknown-key error');
  assert.match(err.hint, /did you mean "title"/);
  assert.equal(err.line, 4);
});

test('rejects an undefined metric reference', () => {
  const issues = issuesFor(MINIMAL.replace('metric: revenue', 'metric: revenu'));
  const err = issues.find((i) => /unknown metric "revenu"/.test(i.message));
  assert.ok(err);
  assert.match(err.hint, /did you mean "revenue"/);
});

test('rejects a widget that runs off the grid', () => {
  const issues = issuesFor(MINIMAL.replace('position: [1, 1]', 'position: [11, 1]'));
  assert.ok(issues.find((i) => /runs off the grid/.test(i.message)));
});

test('warns about overlapping widgets', () => {
  const yaml = MINIMAL + `    - id: second
      type: kpi
      metric: revenue
      position: [2, 1]
      size: [3, 2]
`;
  const issues = issuesFor(yaml);
  assert.ok(issues.find((i) => i.level === 'warning' && /overlaps/.test(i.message)));
});

test('requires the right keys per widget type', () => {
  const issues = issuesFor(MINIMAL.replace('      metric: revenue\n', ''));
  assert.ok(issues.find((i) => /a "kpi" widget needs metric/.test(i.message)));
});

test('rejects an aggregation without a field', () => {
  const issues = issuesFor(MINIMAL.replace('      agg: sum\n      field: amount', '      agg: sum'));
  assert.ok(issues.find((i) => /agg: sum needs a "field"/.test(i.message)));
});

test('rejects an invalid enum value and lists the options', () => {
  const issues = issuesFor(MINIMAL.replace('type: kpi', 'type: pie_chart'));
  const err = issues.find((i) => /is not allowed here/.test(i.message));
  assert.ok(err);
  assert.match(err.hint, /allowed: kpi, line, area/);
});

test('warns when a field is missing from the data', () => {
  const issues = issuesFor(MINIMAL, { fields: { sales: ['rep', 'amount', 'day'] } });
  assert.deepEqual(issues.filter((i) => i.level === 'error'), []);
  const withTypo = issuesFor(MINIMAL.replace('field: amount', 'field: amnt'), { fields: { sales: ['rep', 'amount', 'day'] } });
  const warn = withTypo.find((i) => /not in data source/.test(i.message));
  assert.ok(warn);
  assert.match(warn.hint, /did you mean "amount"/);
});

test('flags credentials pasted into api headers', () => {
  const yaml = MINIMAL.replace(
    `      type: inline\n      rows:\n        - { rep: Ada, amount: 10, day: 2026-01-01 }\n        - { rep: Ada, amount: 5, day: 2026-01-02 }\n        - { rep: Lin, amount: 7, day: 2026-01-02 }`,
    `      type: api\n      url: https://example.com/rows\n      headers: { Authorization: "Bearer sk-live-123" }`
  );
  const issues = issuesFor(yaml);
  assert.ok(issues.find((i) => /looks like a credential/.test(i.message)));
});

/* --------------------------------------------------------------- csv/data */

test('parses csv with quotes, commas and type coercion', () => {
  const rows = coerce(parseCsv('name,amount,note\n"Doe, Jane",1200,"say ""hi"""\nLin,3,ok\n'));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, 'Doe, Jane');
  assert.equal(rows[0].amount, 1200);
  assert.equal(rows[0].note, 'say "hi"');
  assert.equal(rows[1].amount, 3);
});

/* ------------------------------------------------------------------ build */

test('compiles to a single self-contained html file', () => {
  const t = tmp(MINIMAL);
  try {
    const out = compile(t.file, { outDir: join(t.dir, 'dist') });
    const html = readFileSync(join(out.outDir, 'index.html'), 'utf8');
    assert.match(html, /__YADASH_SPEC__/);
    assert.match(html, /yd-grid/);
    assert.match(html, /echarts/);
    assert.ok(html.includes('"id":"demo"'));
    assert.ok(out.files.includes('index.html'));
  } finally {
    t.cleanup();
  }
});

test('build fails loudly on an invalid file', () => {
  const t = tmp(MINIMAL.replace('metric: revenue', 'metric: nope'));
  try {
    assert.throws(() => compile(t.file, { outDir: join(t.dir, 'dist') }), BuildError);
  } finally {
    t.cleanup();
  }
});

test('assigns ids and auto-flows widgets that omit a position', () => {
  const yaml = MINIMAL.replace('      position: [1, 1]\n      size: [3, 2]\n', '') + `    - type: kpi
      metric: revenue
`;
  const t = tmp(yaml);
  try {
    const out = compile(t.file, { outDir: join(t.dir, 'dist'), writeSpec: true });
    const spec = JSON.parse(readFileSync(join(out.outDir, 'spec.json'), 'utf8'));
    assert.equal(spec.widgets[1].id, 'w2');
    assert.deepEqual(spec.widgets[0].position, [1, 1]);
    assert.deepEqual(spec.widgets[1].position, [4, 1]);
  } finally {
    t.cleanup();
  }
});

test('the shipped examples validate and build', () => {
  for (const name of ['sales.yaml', 'support.yaml']) {
    const file = join(ROOT, 'examples', name);
    const { issues } = check(file);
    const errors = issues.filter((i) => i.level === 'error');
    assert.deepEqual(errors, [], `${name}: ${JSON.stringify(errors, null, 2)}`);
    const dir = mkdtempSync(join(tmpdir(), 'yadash-ex-'));
    try {
      compile(file, { outDir: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

/* ------------------------------------------------------- skill + packaging */

// The skill is the product surface for agents, so it gets the same treatment as
// the compiler: if it drifts from the schema or links to a file that does not
// exist, that is a failing test, not a docs nit.

const SKILL_DIR = join(ROOT, 'skills', 'yadash');
const SKILL_MD = readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf8');

test('SKILL.md has valid frontmatter with name and description', () => {
  const m = SKILL_MD.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md must start with a YAML frontmatter block');
  const front = parse(m[1]);
  assert.equal(front.name, 'yadash', 'skill name must match its directory');
  assert.ok(typeof front.description === 'string' && front.description.length > 40,
    'description must be specific enough to trigger on');
  assert.ok(front.description.length <= 1024, 'description must stay under 1024 chars');
});

test('every file SKILL.md points at exists', () => {
  const refs = new Set();
  for (const m of SKILL_MD.matchAll(/`((?:references|examples)\/[a-z0-9._-]+)`/g)) refs.add(m[1]);
  assert.ok(refs.size >= 5, `expected SKILL.md to link its references, found ${refs.size}`);
  for (const ref of refs) {
    assert.ok(existsSync(join(SKILL_DIR, ref)), `SKILL.md links missing file: ${ref}`);
  }
});

test('the skill documents every widget type and aggregation in the schema', () => {
  const docs = ['SKILL.md', 'references/widgets.md', 'references/data.md']
    .map((f) => readFileSync(join(SKILL_DIR, f), 'utf8')).join('\n');
  for (const type of schema.$defs.widget.properties.type.enum) {
    assert.ok(docs.includes('`' + type + '`'), `widget type "${type}" is undocumented`);
  }
  for (const agg of schema.$defs.metric.properties.agg.enum) {
    assert.ok(docs.includes(agg), `agg "${agg}" is undocumented`);
  }
  for (const source of schema.$defs.source.properties.type.enum) {
    assert.ok(docs.includes('`' + source + '`'), `source type "${source}" is undocumented`);
  }
});

test('the skill examples validate and build on their own', () => {
  for (const name of ['starter.yaml', 'live-api.yaml']) {
    const file = join(SKILL_DIR, 'examples', name);
    const { issues } = check(file);
    assert.deepEqual(issues, [], `${name}: ${JSON.stringify(issues, null, 2)}`);
    const dir = mkdtempSync(join(tmpdir(), 'yadash-skill-'));
    try {
      compile(file, { outDir: dir });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the plugin manifests are valid and agree on name and version', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const plugin = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const market = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.equal(plugin.name, 'yadash');
  assert.equal(plugin.version, pkg.version, 'plugin.json and package.json versions must match');
  const portable = JSON.parse(readFileSync(join(ROOT, 'plugin.json'), 'utf8'));
  assert.equal(portable.name, 'yadash');
  assert.equal(portable.version, pkg.version, 'portable plugin.json version must match package.json');
  assert.match(portable.$schema, /agent-plugins\.org/, 'portable manifest needs the Agent Plugins $schema');
  const entry = market.plugins.find((p) => p.name === 'yadash');
  assert.ok(entry, 'marketplace.json must list the yadash plugin');
  assert.equal(entry.version, pkg.version, 'marketplace entry version must match package.json');
  for (const command of ['dashboard.md', 'dashboard-audit.md']) {
    assert.ok(existsSync(join(ROOT, 'commands', command)), `missing command: ${command}`);
  }
});

test('chart widgets are not sized with position: absolute', () => {
  // ECharts sets an inline `position: relative` on its container during
  // init() (it checks the inline style, not the computed style), which
  // silently overrides a CSS `position: absolute` and collapses the
  // container to zero height - every chart renders blank with no error.
  // See src/runtime/runtime.css .yd-chart.
  const css = readFileSync(join(ROOT, 'src', 'runtime', 'runtime.css'), 'utf8');
  const rule = css.match(/\.yd-chart\s*\{[^}]*\}/);
  assert.ok(rule, '.yd-chart rule must exist in runtime.css');
  assert.doesNotMatch(rule[0], /position:\s*absolute/, '.yd-chart must not rely on position: absolute for sizing');
});

test('npm package ships the skill', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  for (const entry of ['skills', 'schema', 'bin', 'src']) {
    assert.ok(pkg.files.includes(entry), `package.json files must include "${entry}"`);
  }
});

/* ----------------------------------------------------------------- report */

if (failures.length) {
  for (const f of failures) {
    console.error(`\n✗ ${f.name}\n  ${f.err.message.split('\n').join('\n  ')}`);
  }
  console.error(`\n${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`✓ ${passed} tests passed`);
