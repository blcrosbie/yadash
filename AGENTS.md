# AGENTS.md

This repo is **yadash**: a dashboard-as-YAML compiler plus the agent skill that
drives it.

## Working on dashboards (the common case)

If you are here to create or change a dashboard, read
[`skills/yadash/SKILL.md`](skills/yadash/SKILL.md) first and follow it. Short
version:

- Edit the YAML, never the generated HTML, and never hand-write chart code.
- `node bin/yadash.mjs validate <file> --json --strict` after every change.
- `node bin/yadash.mjs build <file> -o dist/<id>` to produce the static page.
- Reference material: `skills/yadash/references/{widgets,data,layout,deploy,refactoring}.md`.

## Working on yadash itself

- **Zero runtime dependencies, on purpose.** `node bin/yadash.mjs build x.yaml`
  must work in a cold clone with no network. Do not add a dependency to
  `package.json` without a very good reason; the YAML parser, CSV parser, schema
  validator and dev server are all deliberately hand-rolled and small.
- **Layout**
  - `bin/yadash.mjs` — CLI: validate, build, dev, init, skill, schema.
  - `src/yaml.mjs` — YAML subset parser that tracks line numbers.
  - `src/validate.mjs` — JSON Schema check plus the semantic linter (the part
    that produces agent-readable hints).
  - `src/data.mjs` — build-time data loading and type coercion.
  - `src/compile.mjs` — spec normalization and HTML emission.
  - `src/runtime/` — the browser runtime: filters, aggregation, ECharts render.
  - `schema/dashboard.schema.json` — the contract. Changing it is a spec change.
- **The error messages are a feature.** Every diagnostic carries `level`, `line`,
  `path`, `message` and a `hint` that names the valid alternatives. New
  validation rules must do the same — that is what makes the YAML safe for an
  agent to edit.
- **Tests**: `npm test` (zero-dependency runner in `test/run-tests.mjs`). Any
  schema or linter change needs a test. `npm run validate:examples` must stay
  clean, including `--strict`.
- **Docs stay in sync with the schema.** If you add a widget type, an `agg`, or
  a source type, update `schema/dashboard.schema.json`, the vocabulary table in
  `skills/yadash/SKILL.md`, the matching `references/*.md`, and the README.
  A test checks the skill's reference links resolve.

## Conventions

- ES modules, Node 18+, 2-space indent, no build step.
- Prefer clear code over clever code; this codebase is meant to be read by
  people who are not frontend engineers.
- Keep user-facing text plain and lowercase-ish, matching the existing CLI voice.
