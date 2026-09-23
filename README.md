# yadash

**Dashboards as YAML.** Describe a dashboard in one file, compile it to a single
static HTML page, host it anywhere — and let an AI agent maintain the config
instead of your JSX.

```yaml
version: 1
dashboard:
  id: sales-health
  title: Sales Health
  data:
    activity: { type: csv, path: ./data/sales.csv, date_fields: [day] }
  metrics:
    show_rate: { agg: ratio, field: held, of: booked, format: percent }
  filters:
    - { field: day, type: date_range, label: Date }
    - { field: rep, label: Rep }
  widgets:
    - { id: kpi_show_rate, type: kpi, title: Show rate, metric: show_rate, size: [3, 2] }
    - { id: trend, type: line, title: Meetings per week,
        x: { field: day, bucket: week }, y: { metric: held }, size: [9, 5] }
```

```bash
npx @blcrosbie/yadash build sales.yaml -o dist/sales
# -> dist/sales/index.html   drop it on Pages, S3, WordPress, anywhere
```

No Node at runtime. No nginx. No container. No login. One HTML file.

## Why

Dashboards are configuration pretending to be software. Everything that makes
Kubernetes and Terraform pleasant to work with — declarative text, a schema,
git history, code review, grep, an agent that can edit it safely — has been
locked away in enterprise BI tiers or replaced by a thousand clicks in a format
pane.

yadash is the small version of the good idea:

- **A constrained, validated DSL** an LLM can edit without breaking anything.
  Semantic widget types (`kpi`, `line`, `stacked_bar`, `table`), not chart
  library options. No escape hatch into JavaScript.
- **Diagnostics written for agents and humans.** Every error has a line number,
  a JSONPath, and a hint that lists the valid alternatives: `unknown metric
  "show_rate" — defined metrics: booked, held, pipeline (did you mean "held"?)`.
- **Build-time data checks.** Point at a CSV and a mistyped field name becomes a
  warning with the real column list, not an empty chart nobody notices for three
  weeks.
- **A boring deployable.** `index.html` with the data inlined and one CDN script
  (self-host it with `--vendor` if you prefer). Copy the folder; you are done.
- **Git-native operations.** `grep -rn gross_revenue dashboards/` then one agent
  pass, and 34 of 38 references are updated with the 4 ambiguous ones flagged.
  That workflow does not exist in a point-and-click BI tool.

## Install

```bash
npx @blcrosbie/yadash init sales        # starter dashboard + 60 days of sample data
npx @blcrosbie/yadash dev sales.yaml    # http://localhost:4321, rebuilds on refresh
```

Or clone it — there are no dependencies, so `node bin/yadash.mjs build x.yaml`
works in a cold clone with no network.

## Use it with an agent

The point of a DSL this small is that an agent can drive it. The
[`yadash` skill](skills/yadash/SKILL.md) teaches Claude Code, Codex, Cursor or
anything else that reads `SKILL.md` how to author, edit, audit and deploy these
files.

```bash
npx @blcrosbie/yadash skill install            # -> ./.claude/skills/yadash (this project)
npx @blcrosbie/yadash skill install --global   # -> ~/.claude/skills/yadash
npx @blcrosbie/yadash skill install --codex    # -> ~/.codex/skills/yadash
```

Claude Code users can install the whole plugin (skill + `/dashboard` and
`/dashboard-audit` commands):

```
/plugin marketplace add blcrosbie/yadash
/plugin install yadash@blcrosbie
```

Then talk to it:

> "Make it a 3-column KPI row, put conversion next to show rate, make the rep
> table full width underneath, and flag anything below 50%."

That is a ~15 line YAML diff you can actually review, not a silent rewrite of
4,000 lines of chart code.

## CLI

```
yadash validate <file...>     Check a dashboard without building it
yadash build <file>           Compile to a static site
yadash dev <file>             Serve locally, rebuild on refresh
yadash init [name]            Starter dashboard + sample data
yadash skill install          Install the agent skill (--codex, --global, --to)
yadash schema                 Print the JSON Schema

  -o, --out <dir>    output directory        --embed         no page header (iframes)
      --json         machine-readable        --base <path>   asset URL prefix
      --strict       warnings are errors     --vendor <file> self-host echarts
```

## What you get

- **Widgets**: `kpi`, `line`, `area`, `bar`, `stacked_bar`, `hbar`, `pie`,
  `donut`, `scatter`, `table`, `markdown`.
- **Metrics**: `count`, `sum`, `avg`, `min`, `max`, `distinct_count`, `ratio`,
  each with formatting (`currency`, `percent`, `compact`, `duration`) and
  optional row filters.
- **Filters**: select, multiselect, date range, search — one bar, applied to
  every widget, with state in the URL so a filtered view is a shareable link.
- **Data**: inline rows, CSV, JSON (nested via `root`), or a live `api` source
  with a refresh interval.
- **Layout**: a 12-column grid with explicit `position`/`size`, auto-flow when
  you do not care, and a mobile stack when the screen is narrow.
- **Theming**: light/dark/auto with a designed palette for both, plus `accent`.
- **Embed API**: `window.yadash.setFilter()/setTheme()/refresh()` and the same
  over `postMessage` for iframes.

Full reference: [`skills/yadash/references/`](skills/yadash/references/) —
[widgets](skills/yadash/references/widgets.md) ·
[data & metrics](skills/yadash/references/data.md) ·
[layout](skills/yadash/references/layout.md) ·
[deploy & embed](skills/yadash/references/deploy.md) ·
[refactoring](skills/yadash/references/refactoring.md).

## Embedding

```bash
yadash build sales.yaml -o dist/sales --embed
```

```html
<iframe src="https://dash.example.com/sales/" title="Sales health"
        style="width:100%;height:900px;border:0" loading="lazy"></iframe>
```

Works in a WordPress Custom HTML block, a Wix Embed-a-Site component, Notion,
Confluence, Webflow, or your own app. Drive it from the host page with
`postMessage({ type: 'yadash:setFilter', id: 'rep', value: 'Ada' })`.

## What yadash is not

It is honest about its ceiling, because a tool that oversells itself gets
uninstalled on day two.

- **Not a semantic layer or SQL modeller.** It aggregates rows you hand it.
  Model upstream (dbt, a view, an endpoint) and point a source at the result.
- **No row-level security.** The compiled page is a public file; enforce access
  in the API behind it or at the host.
- **No write-back, drill-through, or bespoke visual types** (sankey, network,
  custom D3).
- **Browser-scale data.** Comfortable into the low hundreds of thousands of
  rows; past that, pre-aggregate.

If you need those, you need Rill, Looker, Holistics, or Power BI. yadash is
Docker Compose for analytics UIs, not a BI platform.

## Prior art worth knowing

[Rill](https://docs.rilldata.com) defines Canvas dashboards in YAML and is the
closest thing to this idea inside a real BI product. Looker's LookML dashboards
have been YAML-in-git for years. [Holistics](https://docs.holistics.io) went
further with a typed DSL (AML) plus agent workflows. Microsoft now ships an
agentic report-authoring skill over Power BI's PBIR JSON. The direction is
validated; what is missing is a vendor-neutral, zero-infrastructure version you
can embed in a WordPress page. That is this.

## Development

```bash
npm test                    # zero-dependency test runner
npm run validate:examples   # the shipped examples must stay clean
npm run build:examples
```

See [AGENTS.md](AGENTS.md) for architecture and conventions.

## License

MIT
