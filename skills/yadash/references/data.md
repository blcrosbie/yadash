# Data, metrics and filters

## Sources

`dashboard.data` is a map of `name: source`. The first one declared is the
default: any metric, widget or filter without an explicit `source:` uses it.

```yaml
data:
  activity:
    type: csv
    path: ./data/sales_activity.csv     # relative to the YAML file
    date_fields: [engagement_date]      # parsed as dates
    number_fields: [pipeline_amount]    # force numeric (csv only; strips $ , %)

  tickets:
    type: json
    path: ./data/tickets.json
    root: data.rows                     # dotted path to the array in the payload
    date_fields: [created_at]

  live:
    type: api
    url: /api/metrics                   # absolute or site-relative, returns JSON
    root: rows
    refresh: 60                         # re-fetch every 60s
    date_fields: [day]

  targets:
    type: inline
    rows:
      - { team: East, target: 120 }
      - { team: West, target: 90 }
```

Numbers and booleans in CSV are coerced automatically; anything ambiguous stays
a string. Declare `date_fields` explicitly — a date left as a string still
sorts and buckets correctly only if it is ISO (`YYYY-MM-DD`), so prefer ISO in
your exports.

`inline`, `csv` and `json` are read at build time and inlined into the page
(large payloads are written to `data/<name>.json` beside the HTML instead).
`api` sources are fetched in the browser at view time, so build-time field
checking cannot help you there.

### api sources and auth

The compiled page is a public static file, so treat the endpoint as public too.
Workable patterns:

- Same-origin endpoint behind the site's own session cookie (requests are sent
  with `credentials: same-origin`).
- A read-only endpoint that returns only aggregates.
- A signed, expiring URL minted by your backend and injected into the page at
  serve time.

Never put a bearer token, API key or database credential in `headers` — the
validator warns, and the warning is correct.

## Metrics

A metric is a named aggregation. Define it once; every widget refers to it by
name, so "revenue" means the same thing on every tile.

```yaml
metrics:
  deals:
    agg: count                  # count needs no field
    label: Deals

  revenue:
    agg: sum
    field: closed_amount
    label: Revenue
    format: currency
    currency: USD
    decimals: 0

  avg_deal:
    agg: avg
    field: closed_amount
    format: currency

  reps_active:
    agg: distinct_count
    field: sales_rep

  close_rate:
    agg: ratio                  # sum(field) / sum(of), recomputed per filter
    field: closed_amount
    of: pipeline_amount
    format: percent

  inbound_revenue:
    agg: sum
    field: closed_amount
    where:                      # row filter for this metric only
      - { field: source, op: eq, value: inbound }
    label: Inbound revenue
```

- `agg`: `count`, `sum`, `avg`, `min`, `max`, `distinct_count`, `ratio`.
- `format`: `number`, `currency`, `percent`, `compact`, `duration`
  (`duration` expects seconds).
- `percent` expects a fraction — `0.82` renders `82%`.
- Ratios are the reason this layer exists. `agg: ratio` re-divides the filtered
  rows; a pre-computed `rate` column averaged across rows is wrong the moment
  anyone touches a filter, and wrong quietly.
- A metric can name a different `source:` than the widget using it, which is how
  one dashboard mixes two datasets.

### where conditions

Used on a metric (`metrics.x.where`) or a widget (`widgets[].where`), ANDed:

```yaml
where:
  - { field: stage, op: in, value: [proposal, negotiation] }
  - { field: amount, op: gte, value: 1000 }
  - { field: lost_reason, op: is_null }
  - { field: title, op: contains, value: renewal }
```

Ops: `eq` (default), `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `not_in`,
`contains`, `is_null`, `not_null`.

## Filters

`dashboard.filters` renders one filter bar above the grid. Every filter applies
to every widget whose source actually contains that field — no per-widget wiring.

```yaml
filters:
  - field: engagement_date
    type: date_range
    label: Date range
    default: { from: 2026-01-01, to: 2026-03-31 }   # explicit dates only

  - field: sales_rep          # type defaults to select
    label: Rep

  - field: activity_type
    type: multiselect
    label: Activity type
    default: [meeting, call]

  - field: region
    type: select
    options: [East, West]     # fixed choices; omit to derive them from the data

  - field: company
    type: search
    label: Search company
```

Notes that matter:

- `select`/`multiselect` options are derived from the data when `options` is
  absent, sorted naturally. Empty values are skipped.
- `date_range` `default` takes literal dates (`{ from:, to: }`). There is no
  `last_30_days` shorthand in v0.1 — if the user asks for a rolling default,
  say it is not supported yet and either set explicit dates or leave it open.
- `compare: previous_period` on a KPI uses the first `date_range` filter's
  active window and shifts it back by exactly that span. With no date filter
  set, there is no delta to show.
- Filter state is written to the URL query string (`?rep=Ada&date=2026-01-01..2026-03-31`),
  so a filtered view is a shareable link.
- `id` defaults to the field name; set it explicitly when two filters target the
  same field or when the URL parameter name matters.
- Add a `source:` to scope a filter to one dataset.

## Date bucketing

Anywhere a date field feeds an axis or dimension, `bucket` groups it: `hour`,
`day`, `week` (ISO, Monday start), `month`, `quarter`, `year`. Bucket to the
grain the user reasons in — daily meeting counts are noise, weekly is a trend.

## Limits and the browser

All aggregation happens client-side on the rows the page holds. That is fine
into the low hundreds of thousands of rows; beyond that, pre-aggregate upstream
and point a source at the summary. If the user's dataset is huge, the right
answer is an `api` source returning grouped rows, not a bigger CSV.
