# Changelog

All notable changes to yadash. The YAML `version: 1` field is the spec version;
while yadash is 0.x, the spec may still change — breaking changes are called out
here explicitly.

## 0.1.0 — unreleased

First release.

- **DSL + schema.** `schema/dashboard.schema.json` (draft 2020-12) covering data
  sources (`inline`, `csv`, `json`, `api`), named metrics (`count`, `sum`, `avg`,
  `min`, `max`, `distinct_count`, `ratio`), filters (select, multiselect, date
  range, search), a 12-column layout and 11 semantic widget types.
- **Compiler.** `yadash build` emits one self-contained `index.html` (data
  inlined, or split to `data/*.json` past ~1.5 MB) plus a normalized
  `spec.json`. `--embed`, `--base`, `--vendor` for embedding and self-hosting.
- **Validator.** JSON Schema check plus a semantic linter: unknown
  metrics/sources/fields, missing widget requirements, off-grid and overlapping
  widgets, credentials pasted into `api` headers. Every diagnostic carries a
  line number, a JSONPath and a hint naming the valid alternatives; `--json`
  for agents and CI.
- **Build-time data checks.** CSV/JSON/inline sources are read at build time, so
  a mistyped field name is a warning with the real column list attached.
- **Dev server.** `yadash dev` rebuilds on refresh and renders build errors in
  the page.
- **Runtime.** Client-side filtering and aggregation, light/dark/auto themes,
  mobile stacking, filter state in the URL, and an embed API
  (`window.yadash.setFilter/setTheme/refresh`, plus `postMessage`).
- **Agent skill.** `skills/yadash/` in the open Agent Skills format, with
  references for widgets, data, layout, deployment and fleet refactoring, and
  two runnable examples. `yadash skill install` places it for Claude
  (`.claude/skills/`) or Codex (`~/.codex/skills/`).
- **Packaging.** Claude Code plugin (`.claude-plugin/`) with `/dashboard` and
  `/dashboard-audit` commands, and a portable Agent Plugins manifest
  (`plugin.json`) for Codex and other hosts.
- Zero runtime dependencies; Node 18+.
