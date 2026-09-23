# Widget reference

Every widget is one entry in `dashboard.widgets`. Shared keys: `id`, `type`,
`title`, `subtitle`, `position`, `size`, `source`, `where`, `limit`,
`empty_message`.

Pick the type from the question the user is asking, not from what looks good.

| the question | the type |
|---|---|
| "what is it right now?" | `kpi` |
| "is it going up?" | `line` (or `area` for a single cumulative total) |
| "who/what is biggest?" | `hbar`, or `table` when they want the numbers too |
| "how does the mix break down?" | `stacked_bar` over time, `donut` for one snapshot |
| "are these two related?" | `scatter` |
| "I need the actual rows" | `table` |

## kpi

```yaml
- id: kpi_show_rate
  type: kpi
  title: Show rate
  metric: show_rate
  compare: previous_period      # delta vs the window just before the active range
  target: 0.8                   # draws a target line under the number
  thresholds:
    - below: 0.7
      state: bad                # good | warn | bad | neutral
      label: Below target
    - above: 0.8
      state: good
  size: [3, 2]
```

Thresholds are evaluated in order and the last match wins, so go from worst to
best. `compare: previous_period` needs a `date_range` filter to have a window to
compare against; without one it renders no delta.

Default size `[3, 2]` on a 12-column grid gives a clean four-across KPI row.

## line, area

```yaml
- id: trend
  type: line
  title: Meetings per week
  x: { field: engagement_date, bucket: week }   # hour day week month quarter year
  y: { metric: meetings_held, label: Meetings }
  smooth: true
  series: { field: region }                     # optional: one line per region
  size: [8, 5]
```

Multiple measures on one chart: `y: { metrics: [meetings_booked, meetings_held] }`.
Do not mix a currency metric and a percent metric on the same axis — split them
into two widgets, or the reader misreads the scale.

`area` is the same shape; use it for one series, or for a total that is
meaningfully "filled" (cumulative, volume). Stacked areas of unrelated series
are hard to read — prefer `stacked_bar`.

## bar, stacked_bar, hbar

```yaml
- id: region_mix
  type: stacked_bar
  title: Pipeline by region, by month
  x: { field: engagement_date, bucket: month }
  y: { metric: pipeline }
  series: { field: region }
  show_legend: true
  size: [8, 5]

- id: top_reps
  type: hbar
  title: Top reps
  dimension: { field: sales_rep, limit: 10 }   # top 10, rest grouped as "Other"
  metric: pipeline
  show_labels: true
  size: [4, 5]
```

`bar` takes `x`/`y` like a line chart (categorical or bucketed x). `hbar` takes
`dimension` + `metric` and is the right call whenever category names are long —
rotated x-axis labels are a readability tax nobody agreed to pay.

## pie, donut

```yaml
- id: source_mix
  type: donut
  title: Pipeline by source
  dimension: { field: source, limit: 6 }
  metric: pipeline
  size: [4, 5]
```

Only for parts of a whole, six slices at most (`limit` enforces it). If the user
wants to compare sizes precisely, give them `hbar` instead and say why.

## scatter

```yaml
- id: spend_vs_revenue
  type: scatter
  title: Spend vs revenue by campaign
  x: { metric: spend, format: currency }
  y: { metric: revenue, format: currency }
  series: { field: campaign }
  size: [6, 5]
```

Both axes are metrics; `series` decides what one point represents (one point per
distinct value of that field).

## table

```yaml
- id: rep_table
  type: table
  title: Rep performance
  dimensions:
    - field: sales_rep
      label: Rep
  metrics: [meetings_booked, meetings_held, show_rate, pipeline]
  columns:                        # optional: order, labels, per-column formatting
    - key: sales_rep
      label: Rep
    - key: meetings_booked
      label: Booked
      bar: true                   # in-cell bar scaled to the column max
    - key: show_rate
      label: Show rate
      thresholds:
        - below: 0.7
          state: bad
        - above: 0.8
          state: good
  sort: { by: pipeline, direction: desc }
  limit: 50
  size: [4, 5]
```

`columns[].key` must be a metric name or one of this table's dimension fields —
the validator rejects anything else. `sort.by` has the same constraint. Two
dimensions give a grouped table (dimension columns first, then metrics).

## markdown

```yaml
- id: notes
  type: markdown
  title: How to read this
  text: |
    **Show rate** is held / booked for the rows currently in view, so every
    filter above changes it.
  size: [12, 2]
```

Use it for metric definitions and caveats. A dashboard that defines its own
terms survives being forwarded to someone who was not in the meeting.

## Formatting

Format lives on the metric (`format`, `decimals`, `currency`) so every widget
showing it agrees. Override per widget with `format:`, or per table column with
`format`/`decimals` — only when that one view genuinely differs (e.g. a compact
axis next to exact table values).

`percent` expects a fraction: `0.82` renders as `82%`.

## Composition patterns that work

- **KPI row on top** (3–4 tiles, `size: [3, 2]`), trend underneath, breakdown
  and detail table below that. It is conventional because it reads top-down.
- **Trend + table side by side** (`[8, 5]` and `[4, 5]`) fills a 12-column row
  exactly.
- **Five or fewer widgets** per screenful. A dashboard answering one question
  well beats one answering nine questions badly, and the user will tell you
  which question actually matters if you ask.
