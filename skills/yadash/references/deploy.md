# Deploying and embedding

`yadash build sales.yaml -o dist/sales` produces:

```
dist/sales/
  index.html          # the whole dashboard: markup, CSS, JS, and usually the data
  data/<name>.json    # only when a source is larger than ~1.5 MB of JSON
  spec.json           # the normalized spec, for tooling; --no-spec to skip
```

The page loads ECharts from jsDelivr by default. Everything else is inline, so
the folder is the deployable. There is no server component.

## Static hosts

| host | how |
|---|---|
| GitHub Pages | commit `dist/` (or build in Actions) and point Pages at it |
| Cloudflare Pages | `npx wrangler pages deploy dist/sales` |
| Netlify | `npx netlify deploy --dir dist/sales --prod` |
| Vercel | `npx vercel deploy dist/sales --prod` |
| S3 / CloudFront | `aws s3 sync dist/sales s3://bucket/sales/ --delete` |
| Any web server | copy the folder into the web root |

Serving from a subpath, use `--base`:

```bash
yadash build sales.yaml -o dist/sales --base /dashboards/sales/
```

Air-gapped or CDN-averse environments: download `echarts.min.js` once and pass
`--vendor ./echarts.min.js`. The library is then copied into `assets/` and
referenced locally, and the build has no external requests at all.

If the host enforces a strict Content-Security-Policy, note that the page uses
inline `<style>` and `<script>`; it needs `'unsafe-inline'`, or serve it from
its own origin in an iframe (below) where the parent's CSP does not apply.

## Embedding

Build with `--embed` to drop the page's own title and description block, so the
host page can supply its own heading:

```bash
yadash build sales.yaml -o dist/sales-embed --embed
```

### Any site, including WordPress and Wix

Host the built folder anywhere, then embed the URL in an iframe:

```html
<iframe src="https://dash.example.com/sales/" title="Sales health"
        style="width:100%;height:900px;border:0" loading="lazy"></iframe>
```

- **WordPress**: a Custom HTML block with that iframe. To serve it from the same
  domain, upload the folder to `wp-content/uploads/dashboards/sales/` (or
  anywhere static) and point the iframe at it. No plugin required.
- **Wix**: Embed → Embed a Site (the HTML iframe component), paste the URL.
- **Notion / Confluence / Coda / Google Sites**: paste the URL as an embed.
- **Squarespace / Webflow**: an embed or custom-code block with the same iframe.

Give the iframe a real height — the dashboard fills its container and cannot
resize the parent frame. Roughly `120 + sum of row heights + gaps`; when in
doubt, build it, open it, and measure.

### Same-page embed

For a page you control, copy the contents of `<body>` in and keep the `<style>`
and both `<script>` tags, or simply serve `index.html` in an iframe — the iframe
is less trouble and isolates the CSS.

## Driving the dashboard from the host page

The runtime exposes a small API on `window.yadash`:

```js
yadash.spec                       // the normalized spec
yadash.getFilters()               // current filter state
yadash.setFilter('sales_rep', 'Ada')
yadash.setFilter('engagement_date', { from: '2026-01-01', to: '2026-03-31' })
yadash.setFilter('activity_type', ['meeting', 'call'])   // multiselect
yadash.setTheme('dark')           // 'light' | 'dark'
yadash.refresh()                  // re-fetch api sources and re-render
```

Across an iframe boundary, post messages instead:

```js
const frame = document.querySelector('iframe').contentWindow;
frame.postMessage({ type: 'yadash:setFilter', id: 'sales_rep', value: 'Ada' }, '*');
frame.postMessage({ type: 'yadash:setTheme', theme: 'dark' }, '*');
frame.postMessage({ type: 'yadash:refresh' }, '*');
```

Filter ids are the filter's `id`, defaulting to its field name.

### Deep links

Filter state lives in the query string, so a filtered view is a URL:

```
/sales/?sales_rep=Ada&engagement_date=2026-01-01..2026-03-31&activity_type=meeting|call
```

Multiselect values are `|`-separated; date ranges are `from..to`. Handy for
"send me the link to your numbers" and for pre-filtering an embed per page.

## Keeping it fresh

- **Data in git** (`csv`/`json`): rebuild on push. A GitHub Actions job running
  `yadash build` and deploying `dist/` is about fifteen lines.
- **Live data** (`api`): build once, deploy once. The page re-fetches on load
  and every `refresh:` interval, so the numbers move without a rebuild.
- **Scheduled refresh without an API**: cron a script that writes the CSV, runs
  `yadash build`, and syncs the folder.

Always deploy from a clean `yadash validate --strict` — it is the difference
between a broken tile and a failed build, and you want the failure in CI.
