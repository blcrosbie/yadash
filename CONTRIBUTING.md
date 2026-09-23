# Contributing

`npm test` is the whole build. There are no dependencies to install and no build
step — that is a feature, and PRs that add a runtime dependency need to argue
for it.

```bash
git clone https://github.com/blcrosbie/yadash && cd yadash
npm test                     # zero-dependency test runner
npm run validate:examples    # the shipped examples must stay clean, --strict
node bin/yadash.mjs dev examples/sales.yaml
```

## What makes a good PR here

- **A test.** Any change to the schema, the validator or the compiler needs one
  in `test/run-tests.mjs`. Copy the nearest existing test.
- **Diagnostics that teach.** New validation rules carry a line number, a
  JSONPath, a plain-English message and a `hint` that names the valid
  alternatives. That is what makes the YAML safe for an agent to edit; a bare
  "invalid value" is not acceptable.
- **Docs in the same commit.** Add a widget type, an `agg` or a source type and
  you also update `schema/dashboard.schema.json`, `skills/yadash/SKILL.md`, the
  matching `skills/yadash/references/*.md` and the README. A test checks the
  skill documents everything in the schema, so drift fails CI.
- **Restraint in the DSL.** The vocabulary is deliberately opinionated and there
  is no JavaScript escape hatch. Proposals that let YAML express arbitrary chart
  library options will be declined — open an issue describing the *outcome* you
  need instead, and we will look for a semantic property that covers it.

See [AGENTS.md](AGENTS.md) for the architecture tour.

## Reporting a dashboard that will not build

Include the YAML (trimmed to the smallest failing case) and the output of:

```bash
yadash validate your-dashboard.yaml --json --strict
```

That output has everything needed to reproduce, and it usually shows the fix.
