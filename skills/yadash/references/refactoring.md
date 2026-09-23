# Fleet operations: auditing and refactoring dashboards

Dashboards as text means the operations that are miserable in a BI tool — "which
dashboards still use the old revenue field?", "rename this metric everywhere" —
are just grep and a careful edit. This is the part that makes BI-as-code worth
the switch, so do it properly.

Assume a layout like:

```
dashboards/
  sales.yaml
  support.yaml
  marketing.yaml
data/
```

## 1. Find

```bash
grep -rn "gross_revenue" dashboards/
grep -rln "type: api" dashboards/          # which dashboards depend on live endpoints
grep -rn "agg: avg" dashboards/            # averaged rates worth reviewing
```

Report what you found before changing anything: file, line, and what the
reference is (a metric definition, a widget reference, a filter, a `where`).

## 2. Distinguish the two kinds of rename

- **Renaming a data field** (`gross_revenue` → `net_revenue` in the source):
  every `field:`, `of:`, filter `field:`, `where` condition and table column
  `key` pointing at it must change. The data file has to change too, or the
  build warns that the field does not exist.
- **Renaming a metric** (`revenue` → `net_revenue` as a metric name): the key
  under `metrics:` plus every `metric:`, `metrics: [...]`, `sort.by`, and table
  `columns[].key` that names it. Widget ids and titles are untouched unless the
  user asked for the label to change too.

Do not conflate them. Ask which one they mean when the word is ambiguous — it
usually is.

## 3. Flag what needs human judgement

Some references cannot be mechanically swapped:

- A `ratio` metric whose numerator or denominator you are renaming: confirm the
  new field means the same thing (net vs gross changes the number, not just the
  name).
- Thresholds and targets calibrated to the old metric (`below: 0.7` on a gross
  rate may be wrong for a net rate).
- Titles and markdown text that name the old metric in prose.
- `api` sources, where the field list cannot be verified at build time.

Change what is safe, list what is not, and say why. "Replaced 34 of 38
references; 4 need review because they feed calculated ratios" is the useful
report.

## 4. Verify

```bash
yadash validate dashboards --json --strict
```

Zero errors and zero warnings, or the refactor is not finished. Then build the
affected dashboards so you know they still render:

```bash
for f in dashboards/*.yaml; do yadash build "$f" -o "dist/$(basename "${f%.yaml}")"; done
```

## Audit checklist

Run this when the user asks for a review of existing dashboards:

- **Credentials in YAML**: `grep -rniE "bearer|api[_-]?key|token|secret|password" dashboards/`
  — anything found is a finding, not a nit; the compiled page is public.
- **Filter-unsafe rates**: metrics using `agg: avg` on a column that is already
  a percentage, or a `field` named `*_rate`/`*_pct`. These break under filters;
  rewrite as `agg: ratio` with the two underlying fields.
- **Duplicate definitions**: the same aggregation written twice under different
  metric names. Collapse them, or the two tiles will drift apart.
- **Orphans**: metrics defined and never referenced; widgets whose source no
  longer exists. Both are build errors or dead weight.
- **Unlabelled tiles**: no `title`, or a title that repeats the metric label
  without saying what it means. A markdown tile defining the terms is cheap.
- **`pie`/`donut` with more than 6 slices**: add `limit:` or switch to `hbar`.
- **Overlaps and off-grid widgets**: `validate --strict` catches these; a
  dashboard with warnings has probably never been looked at in a browser.
- **Stale hardcoded date ranges**: a filter `default: { from:, to: }` from last
  quarter, still shipping.

## Git hygiene

- One dashboard change per commit, with the request in the message ("sales:
  add rep filter, widen rep table to full width").
- Never commit the build output and the YAML in the same commit if `dist/` is
  generated in CI — pick one source of truth.
- The diff *is* the review artifact. Keep edits minimal so a non-engineer can
  read them: no reformatting, no key reordering, no drive-by improvements.
