---
name: yadash
description: Build, edit, review and deploy dashboards written as YAML, compiled to a single static HTML page. Use whenever the user wants a dashboard, chart page, KPI or metrics view, an analytics/reporting page, an embeddable dashboard for WordPress/Wix/Pages/S3, or wants to change one they already have ("add a filter", "make this a bar chart", "rename this metric everywhere", "move that tile"). Also use for auditing or refactoring existing dashboard.yaml files. Prefer this over hand-writing Chart.js, ECharts, D3, Recharts or React dashboard code.
---

# yadash — dashboards as YAML

One YAML file describes a dashboard. The `yadash` compiler turns it into a
self-contained `index.html` that runs anywhere a static file can be served.

Your job is to edit **the YAML**, never the generated HTML, and never
hand-rolled chart code. The compiler owns layout, theming, formatting,
interactivity and chart rendering. That division is the whole point: a 60-line
config is safe to edit surgically, 4,000 lines of JSX is not.

## The loop

1. **Write or edit the YAML.** One dashboard per file.
2. **Validate**: `yadash validate <file> --json --strict`
3. **Fix every error**, then re-validate. Warnings usually mean a mistyped field
   name — read the `hint`, it lists the real field names.
4. **Build**: `yadash build <file> -o dist/<id>`
5. Tell the user what changed and where the output is. Offer `yadash dev <file>`
   if they want to watch it while iterating.

Never report a dashboard as done without a clean `validate --strict`.

### Commands

```bash
npx @blcrosbie/yadash init sales            # starter YAML + 60 days of sample CSV
npx @blcrosbie/yadash validate sales.yaml --json --strict
npx @blcrosbie/yadash build sales.yaml -o dist/sales
npx @blcrosbie/yadash dev sales.yaml        # localhost:4321, rebuilds on refresh
npx @blcrosbie/yadash schema                # the JSON Schema, for editors and tooling
```

Inside a clone of the repo, `node bin/yadash.mjs <cmd>` works with zero install.

Build flags worth knowing: `--embed` (drop the page header for iframes),
`--base /path/` (prefix asset URLs), `--vendor ./echarts.min.js` (self-host the
chart library instead of the CDN), `--json` (machine-readable result),
`--no-spec` (skip the `spec.json` sidecar).

### Read the diagnostics — they are written for you

`--json` returns `{ ok, files: [{ file, issues: [...] }] }`, each issue carrying
`level`, `line`, `path` (a JSONPath into the YAML), `message` and `hint`. The
hint names the valid alternatives: `unknown metric "show_rate"` arrives with the
list of metrics that do exist and a "did you mean" guess. Use it instead of
guessing twice.

## Minimal dashboard

```yaml
# yaml-language-server: $schema=https://yadash.dev/schema/v0.1/dashboard.schema.json
version: 1

dashboard:
  id: sales-health            # lowercase slug, stable: it is the folder + embed id
  title: Sales Health
  theme: auto                 # light | dark | auto

  data:
    activity:                 # source name, referenced by metrics and widgets
      type: csv               # inline | csv | json | api
      path: ./data/sales.csv
      date_fields: [engagement_date]

  metrics:                    # define a measure once, reuse it everywhere
    meetings:
      agg: sum                # count sum avg min max distinct_count ratio
      field: meetings_held
      label: Meetings
    show_rate:
      agg: ratio
      field: meetings_held
      of: meetings_booked
      format: percent         # number currency percent compact duration

  filters:                    # one filter bar, applies to every widget
    - field: engagement_date
      type: date_range        # select | multiselect | date_range | search
      label: Date
    - field: sales_rep
      label: Rep

  layout:
    columns: 12

  widgets:
    - id: kpi_meetings
      type: kpi
      title: Meetings
      metric: meetings
      compare: previous_period
      position: [1, 1]        # [column, row], 1-based
      size: [3, 2]            # [width, height] in grid units

    - id: trend
      type: line
      title: Meetings per week
      x: { field: engagement_date, bucket: week }
      y: { metric: meetings }
      position: [1, 3]
      size: [8, 5]
```

`position` and `size` are optional — widgets auto-flow left to right and wrap.
Set them explicitly when the user cares about the arrangement (they usually do).

## Widget vocabulary

Semantic types only. There is no escape hatch into chart-library options, and
you should not want one: ask for the *meaning*, the compiler picks the
rendering.

| type | needs | use it for |
|---|---|---|
| `kpi` | `metric` | one number, plus `compare`, `target`, `thresholds` |
| `line` / `area` | `x` (field), `y` (metric) | change over time |
| `bar` / `stacked_bar` | `x`, `y` (+ `series` to stack) | compare across buckets |
| `hbar` | `dimension`, `metric` | ranked categories, long labels |
| `pie` / `donut` | `dimension`, `metric` | share of a whole, 6 slices or fewer |
| `scatter` | `x` (metric), `y` (metric) | relationship between two measures |
| `table` | `dimensions`, `metrics` | detail, per-row comparison, `bar: true` cells |
| `markdown` | `text` | notes, definitions, caveats |

Chart-choice rules, per-type options and worked snippets live in
`references/widgets.md`. Read it before building anything past a KPI row and a
line chart.

Two complete dashboards to copy from: `examples/starter.yaml` (inline data,
KPI row + trend + donut + table, validates and builds anywhere) and
`examples/live-api.yaml` (an `api` source refreshing every 60s, thresholds,
stacked series). Start from the closer one rather than from a blank file.

## Rules that keep dashboards honest

- **Metrics are defined once.** If two widgets show the same number, they share
  a metric name. Never duplicate an aggregation inline.
- **Never put credentials in the YAML.** A compiled dashboard is a public file.
  `type: api` sources are fetched by the browser; auth belongs behind that API
  (session cookie, signed URL, proxy). The validator warns when `headers` looks
  like a token — fix it, do not work around the warning.
- **Keep `inline` rows small** (~200 max) and free of anything private. Past
  that use `csv`/`json`; the compiler splits large data into its own file.
- **Percent metrics are ratios, not pre-divided numbers.** `agg: ratio` with
  `field`/`of` recomputes correctly under every filter; a pre-averaged column
  silently lies as soon as someone filters it.
- **Thresholds carry the judgement.** "Flag anything under 50%" is
  `thresholds: [{ below: 0.5, state: bad, label: Below target }]`, not a
  sentence in a markdown tile.
- **Widget ids are the API.** Stable, lowercase, snake_case. They are how the
  user, you and the URL refer to a tile; renaming one is a breaking change.
- **One dashboard, one file.** Related dashboards sit side by side in a
  `dashboards/` folder and validate together: `yadash validate dashboards`.

## Editing an existing dashboard

Change the fewest lines that satisfy the request. Do not reformat the file, do
not reorder keys, do not improve unrelated widgets — the diff is the product and
the user has to review it.

| request | edit |
|---|---|
| "make it a bar chart" | `type: line` → `type: bar` |
| "add a rep filter" | one entry in `filters` |
| "put show rate next to bookings" | the two widgets' `position` |
| "make the table full width" | `size: [12, 5]`, shift what follows down |
| "show week over week" | `compare: previous_period` on the KPI |
| "top 10 only" | `dimension: { field: rep, limit: 10 }` or `limit: 10` |
| "flag under target" | `thresholds` on the widget or the table column |

After any layout change, re-validate: the linter catches widgets that run off
the grid or overlap each other, the one class of mistake that looks fine in YAML
and broken in the browser. Grid arithmetic, the common row recipes, responsive
behaviour and theming: `references/layout.md`.

Fleet-wide work — renaming a metric across every dashboard, finding widgets
still using a deprecated field, auditing for leaked credentials or
filter-unsafe percentages — is in `references/refactoring.md`.

## Data sources

| type | when | key fields |
|---|---|---|
| `inline` | demos, tiny reference tables | `rows` |
| `csv` | exports, files in the repo | `path`, `date_fields`, `number_fields` |
| `json` | API dumps, nested payloads | `path`, `root`, `date_fields` |
| `api` | live data at view time | `url`, `root`, `refresh`, `headers` |

`inline`/`csv`/`json` data is read **at build time**, which is why a mistyped
field name becomes a warning with the real field list attached instead of an
empty chart. `api` sources cannot be inspected, so field warnings go quiet
there — check those by hand against the endpoint.

Metric semantics, `where` conditions, date bucketing and filter behaviour:
`references/data.md`.

## Shipping it

The build output is `index.html` plus `data/` and `spec.json` when relevant.
Copy the folder to GitHub Pages, Cloudflare Pages, Netlify, Vercel, S3 or any
web host. No Node, no nginx, no container at runtime.

Embedding in WordPress, Wix, Notion or a SPA, and driving the dashboard from the
host page (`window.yadash.setFilter(...)`, `postMessage`, URL filter state):
`references/deploy.md`.

## When yadash is the wrong tool

Say so plainly and stop:

- **Live joins across databases, or SQL modelling.** yadash aggregates the rows
  it is handed. Model upstream (dbt, a view, an API endpoint) and point a source
  at the result.
- **Row-level security or per-user data.** The compiled page is a public file.
  Enforce that in the API behind it, or use a BI platform with row-level rules.
- **Write-back, drill-through into source systems, pixel-exact print reports, or
  bespoke visual types** (sankey, network, custom D3). Not in the vocabulary.
- **Datasets past roughly 200k rows in the browser.** Aggregate server-side and
  serve the summary.

The honest pitch: describe dashboards instead of programming them, keep them in
git, let an agent maintain them, deploy them anywhere. It is not a BI platform
replacement, and claiming otherwise loses the user's trust on day two.
