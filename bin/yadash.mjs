#!/usr/bin/env node
// yadash CLI - validate and compile dashboard.yaml files.
// Zero dependencies on purpose: `node bin/yadash.mjs build x.yaml` works in a
// cold clone with no network.

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, extname, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { check, compile, BuildError, SCHEMA_PATH, DEFAULT_ECHARTS } from '../src/compile.mjs';

const VERSION = '0.1.0';
const argv = process.argv.slice(2);
const command = argv[0];
const flags = parseFlags(argv.slice(1));
const positional = flags._;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  red: (s) => (color ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (color ? `\x1b[33m${s}\x1b[0m` : s),
  green: (s) => (color ? `\x1b[32m${s}\x1b[0m` : s),
  dim: (s) => (color ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (color ? `\x1b[1m${s}\x1b[0m` : s),
};

try {
  switch (command) {
    case 'validate': await cmdValidate(); break;
    case 'build': await cmdBuild(); break;
    case 'dev': await cmdDev(); break;
    case 'init': await cmdInit(); break;
    case 'skill': await cmdSkill(); break;
    case 'schema': process.stdout.write(readFileSync(SCHEMA_PATH, 'utf8')); break;
    case '--version': case '-v': case 'version': console.log(VERSION); break;
    case undefined: case 'help': case '--help': case '-h': usage(); break;
    default:
      console.error(`Unknown command "${command}"\n`);
      usage();
      process.exit(2);
  }
} catch (err) {
  if (err instanceof BuildError) {
    report(err.issues, err.entry);
    process.exit(1);
  }
  console.error(c.red(err.stack || err.message));
  process.exit(1);
}

/* ------------------------------------------------------------------ commands */

function usage() {
  console.log(`yadash ${VERSION} - dashboards as YAML

  yadash validate <file.yaml...>     Check a dashboard without building it
  yadash build <file.yaml>           Compile to a static site
  yadash dev <file.yaml>             Serve it locally, rebuilding on refresh
  yadash init [name]                 Create a starter dashboard + sample data
  yadash skill install [--codex]     Install the agent skill for Claude/Codex
  yadash schema                      Print the JSON Schema

Options
  -o, --out <dir>        Output directory (default: ./dist)
      --json             Machine-readable diagnostics (for agents and CI)
      --strict           Treat warnings as errors
      --embed            Omit the page header/title chrome (for iframes)
      --base <path>      Prefix for asset URLs, e.g. /dashboards/sales/
      --echarts <url>    Override the charting library URL
      --vendor <file>    Copy a local echarts.min.js into the build instead
      --port <n>         dev server port (default 4321)
      --no-spec          Do not emit spec.json next to index.html

Examples
  node bin/yadash.mjs validate examples/sales.yaml
  node bin/yadash.mjs build examples/sales.yaml -o dist/sales
  node bin/yadash.mjs dev examples/sales.yaml --port 4321`);
}

async function cmdValidate() {
  const targets = expand(positional);
  if (!targets.length) fail('validate needs at least one .yaml file');
  let errors = 0;
  let warnings = 0;
  const payload = [];
  for (const file of targets) {
    const { issues } = check(file);
    errors += issues.filter((i) => i.level === 'error').length;
    warnings += issues.filter((i) => i.level === 'warning').length;
    if (flags.json) payload.push({ file: rel(file), issues });
    else report(issues, file);
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: errors === 0 && (!flags.strict || warnings === 0), files: payload }, null, 2));
  } else if (errors === 0 && warnings === 0) {
    console.log(c.green(`✓ ${targets.length} file(s) valid`));
  } else {
    console.log(`${errors ? c.red(errors + ' error(s)') : c.green('0 errors')}, ${warnings ? c.yellow(warnings + ' warning(s)') : '0 warnings'}`);
  }
  if (errors || (flags.strict && warnings)) process.exit(1);
}

async function cmdBuild() {
  const entry = positional[0];
  if (!entry) fail('build needs a .yaml file');
  let result;
  try {
    result = compile(entry, {
      outDir: flags.out || flags.o,
      embed: !!flags.embed,
      base: flags.base,
      echarts: flags.echarts,
      vendorEcharts: flags.vendor,
      writeSpec: flags['no-spec'] ? false : true,
    });
  } catch (err) {
    if (err instanceof BuildError) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, file: rel(entry), issues: err.issues }, null, 2));
      } else {
        report(err.issues, entry);
        console.error(c.red(`✗ build failed - ${err.message}`));
      }
      process.exit(1);
    }
    throw err;
  }
  const warnings = result.issues.filter((i) => i.level === 'warning');
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, outDir: rel(result.outDir), files: result.files, bytes: result.bytes, issues: result.issues }, null, 2));
  } else {
    if (warnings.length) report(result.issues, entry);
    console.log(c.green('✓ built ') + rel(join(result.outDir, 'index.html')) + c.dim(`  (${(result.bytes / 1024).toFixed(0)} KB, ${result.files.length} file(s))`));
    console.log(c.dim('  open it directly, or copy the folder to any static host'));
  }
  if (flags.strict && warnings.length) process.exit(1);
}

async function cmdDev() {
  const entry = positional[0];
  if (!entry) fail('dev needs a .yaml file');
  const port = Number(flags.port || 4321);
  const outDir = resolve(flags.out || flags.o || join(process.cwd(), '.yadash-dev'));

  const rebuild = () => {
    try {
      const result = compile(entry, { outDir, writeSpec: false, echarts: flags.echarts, vendorEcharts: flags.vendor });
      const warnings = result.issues.filter((i) => i.level === 'warning');
      console.log(c.green('✓ rebuilt ') + new Date().toLocaleTimeString() + (warnings.length ? c.yellow(`  ${warnings.length} warning(s)`) : ''));
      return null;
    } catch (err) {
      if (err instanceof BuildError) {
        report(err.issues, entry);
        return err.issues;
      }
      throw err;
    }
  };

  rebuild();
  createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    let issues = null;
    if (url.pathname === '/' || url.pathname === '/index.html') issues = rebuild();
    if (issues) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      res.end(errorPage(issues, entry));
      return;
    }
    const target = join(outDir, url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, ''));
    if (!target.startsWith(outDir) || !existsSync(target) || statSync(target).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.csv': 'text/csv' };
    res.writeHead(200, { 'content-type': types[extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(target));
  }).listen(port, () => {
    console.log(`\n  ${c.bold('yadash dev')}  http://localhost:${port}`);
    console.log(c.dim('  edit the YAML and refresh the page to rebuild. Ctrl+C to stop.\n'));
  });
}

async function cmdInit() {
  const name = positional[0] || 'dashboard';
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dashboard';
  const yamlPath = resolve(`${slug}.yaml`);
  const dataPath = resolve('data', `${slug}.csv`);
  if (existsSync(yamlPath)) fail(`${rel(yamlPath)} already exists`);
  mkdirSync(resolve('data'), { recursive: true });

  const rows = [['date', 'rep', 'source', 'meetings', 'showed', 'amount']];
  const reps = ['Avery', 'Jordan', 'Priya', 'Sam'];
  const sources = ['inbound', 'outbound', 'referral'];
  const start = new Date(Date.now() - 59 * 86400000);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let d = 0; d < 60; d++) {
    const day = new Date(start.getTime() + d * 86400000).toISOString().slice(0, 10);
    for (const rep of reps) {
      const meetings = Math.round(rand() * 4);
      if (!meetings) continue;
      rows.push([day, rep, sources[Math.floor(rand() * sources.length)], meetings, Math.round(meetings * (0.5 + rand() * 0.5)), Math.round(rand() * 8000)]);
    }
  }
  writeFileSync(dataPath, rows.map((r) => r.join(',')).join('\n') + '\n');
  writeFileSync(yamlPath, starterYaml(slug, name, relative(process.cwd(), dataPath).replace(/\\/g, '/')));
  console.log(c.green('✓ created ') + rel(yamlPath) + ' and ' + rel(dataPath));
  console.log(c.dim(`  next: node ${rel(process.argv[1])} dev ${rel(yamlPath)}`));
}

async function cmdSkill() {
  const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(PKG_ROOT, 'skills', 'yadash');
  if (!existsSync(src)) fail(`the bundled skill is missing (looked in ${rel(src)})`);

  const sub = positional[0] || 'info';
  const targets = {
    claude: join(process.cwd(), '.claude', 'skills', 'yadash'),
    'claude-global': join(homedir(), '.claude', 'skills', 'yadash'),
    codex: join(homedir(), '.codex', 'skills', 'yadash'),
  };

  if (sub === 'info' || sub === 'where') {
    console.log(`The yadash skill lives at ${c.bold(rel(src))}\n`);
    console.log('Install it where your agent looks for skills:\n');
    console.log(`  yadash skill install             ${c.dim('-> ./.claude/skills/yadash   (this project)')}`);
    console.log(`  yadash skill install --global    ${c.dim('-> ~/.claude/skills/yadash   (every project)')}`);
    console.log(`  yadash skill install --codex     ${c.dim('-> ~/.codex/skills/yadash')}`);
    console.log(`  yadash skill install --to <dir>  ${c.dim('-> anywhere else')}`);
    console.log(c.dim('\nSKILL.md follows the open Agent Skills format, so any agent that reads'));
    console.log(c.dim('SKILL.md can use the same directory.'));
    return;
  }

  if (sub !== 'install') fail(`unknown skill subcommand "${sub}" - try: yadash skill install`);

  const dest = resolve(
    flags.to
      ? String(flags.to)
      : flags.codex
        ? targets.codex
        : flags.global || flags.g
          ? targets['claude-global']
          : targets.claude
  );

  if (existsSync(dest) && !flags.force && !flags.f) {
    fail(`${rel(dest)} already exists - re-run with --force to overwrite it`);
  }
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });

  const copied = copyDir(src, dest);
  console.log(c.green('✓ installed ') + `${copied} file(s) to ` + rel(dest));
  console.log(c.dim('  start a new agent session, then ask for a dashboard.'));
  console.log(c.dim('\n  For tools that read AGENTS.md instead, add:'));
  console.log(c.dim(`    ## Dashboards\n    Dashboards in this repo are yadash YAML. Read ${rel(join(dest, 'SKILL.md'))}\n    before creating or editing one. Never hand-write chart code.`));
}

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  let count = 0;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const a = join(from, entry.name);
    const b = join(to, entry.name);
    if (entry.isDirectory()) count += copyDir(a, b);
    else { copyFileSync(a, b); count++; }
  }
  return count;
}

/* ------------------------------------------------------------------- output */

function report(issues, file) {
  if (!issues || !issues.length) return;
  const lines = file && existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  for (const issue of issues) {
    const tag = issue.level === 'error' ? c.red('error') : c.yellow('warning');
    const where = `${rel(file)}${issue.line ? ':' + issue.line : ''}`;
    console.error(`${tag} ${c.bold(where)}  ${issue.message}`);
    if (issue.line && lines[issue.line - 1] !== undefined) {
      console.error(c.dim(`  ${String(issue.line).padStart(4)} | `) + lines[issue.line - 1]);
    }
    if (issue.hint) console.error(c.dim(`       ↳ ${issue.hint}`));
    console.error(c.dim(`       at ${issue.path}`));
  }
}

function errorPage(issues, file) {
  const rows = issues.map((i) => `<li><b>${i.level}</b> line ${i.line ?? '?'}: ${escape(i.message)}${i.hint ? `<br><small>${escape(i.hint)}</small>` : ''}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>yadash build failed</title>
<body style="font:14px system-ui;padding:32px;max-width:760px;margin:auto">
<h1 style="font-size:18px">Build failed - ${escape(basename(file))}</h1>
<ul style="line-height:1.7">${rows}</ul>
<p style="color:#666">Fix the YAML and refresh.</p>`;
}

function escape(s) {
  return String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
}

/* -------------------------------------------------------------------- utils */

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out._.push(...args.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const [key, inline] = a.slice(2).split('=');
      if (inline !== undefined) out[key] = inline;
      else if (args[i + 1] && !args[i + 1].startsWith('-')) out[key] = args[++i];
      else out[key] = true;
    } else if (a.startsWith('-') && a.length === 2) {
      out[a.slice(1)] = args[i + 1] && !args[i + 1].startsWith('-') ? args[++i] : true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function expand(targets) {
  const files = [];
  for (const t of targets) {
    const p = resolve(t);
    if (existsSync(p) && statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) {
        if (/\.ya?ml$/.test(f)) files.push(join(p, f));
      }
    } else {
      files.push(p);
    }
  }
  return files;
}

function rel(p) {
  if (!p) return '';
  const r = relative(process.cwd(), p);
  return r.startsWith('..') ? p : r.replace(/\\/g, '/');
}

function fail(message) {
  console.error(c.red('error ') + message);
  process.exit(2);
}

function starterYaml(slug, title, dataPath) {
  return `# ${title} - edit this file, run \`yadash dev ${slug}.yaml\`, refresh.
# Schema: ${DEFAULT_ECHARTS ? 'schema/dashboard.schema.json' : ''}
# yaml-language-server: $schema=https://yadash.dev/schema/v0.1/dashboard.schema.json
version: 1

dashboard:
  id: ${slug}
  title: ${title}
  theme: auto

  data:
    activity:
      type: csv
      path: ${dataPath}
      date_fields: [date]

  metrics:
    meetings:
      agg: sum
      field: meetings
      label: Meetings
    show_rate:
      agg: ratio
      field: showed
      of: meetings
      label: Show rate
      format: percent
    revenue:
      agg: sum
      field: amount
      label: Revenue
      format: currency

  filters:
    - field: date
      type: date_range
      label: Date
    - field: rep
      label: Rep
    - field: source
      label: Source

  layout:
    columns: 12

  widgets:
    - id: total_meetings
      type: kpi
      title: Meetings
      metric: meetings
      position: [1, 1]
      size: [3, 2]

    - id: show_rate
      type: kpi
      title: Show rate
      metric: show_rate
      thresholds:
        - below: 0.5
          state: bad
          label: Below target
      position: [4, 1]
      size: [3, 2]

    - id: revenue
      type: kpi
      title: Revenue
      metric: revenue
      compare: previous_period
      position: [7, 1]
      size: [3, 2]

    - id: trend
      type: line
      title: Meetings over time
      x:
        field: date
        bucket: week
      y:
        metric: meetings
      position: [1, 3]
      size: [8, 5]

    - id: by_rep
      type: table
      title: Rep performance
      dimensions:
        - field: rep
      metrics: [meetings, show_rate, revenue]
      sort:
        by: meetings
        direction: desc
      position: [9, 3]
      size: [4, 5]
`;
}
