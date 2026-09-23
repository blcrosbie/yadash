---
description: Audit every dashboard YAML in this repo for correctness, leaked credentials and misleading metrics
argument-hint: [optional folder, defaults to searching the repo]
---

Use the `yadash` skill, and follow the audit checklist in its
`references/refactoring.md`.

Scope: $ARGUMENTS (default: every `*.yaml` in the repo that contains a
`dashboard:` key).

Do all of this before reporting:

1. `yadash validate <folder> --json --strict` on each dashboard folder.
2. Grep for credentials in the YAML (`bearer`, `api key`, `token`, `secret`,
   `password`). Anything found is a finding, not a nit.
3. Flag filter-unsafe rates: `agg: avg` over an already-percentage column, or a
   `field` ending in `_rate`/`_pct` that should be `agg: ratio`.
4. Flag duplicate metric definitions, orphaned metrics, untitled widgets,
   `pie`/`donut` over 6 slices, and stale hardcoded date defaults.

Report findings grouped by file, most severe first, each with the line number
and the concrete fix. Do not change anything unless asked — end by offering to
apply the safe fixes and listing which ones need a human decision.
