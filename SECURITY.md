# Security

## The one thing to understand

**A compiled dashboard is a public static file.** Everything in it — the spec,
inlined rows, `api` URLs and any headers you configured — is readable by anyone
who can open the page, including via `view-source`.

So:

- **Never put credentials in the YAML.** No bearer tokens, API keys, database
  URLs or passwords, including in `data.*.headers`. `yadash validate` warns when
  a header value looks like a credential; that warning is right.
- **Put authentication behind your API**, not in the dashboard: a same-origin
  endpoint protected by the site's session cookie, a short-lived signed URL
  minted server-side, or an endpoint that only ever returns aggregates.
- **There is no row-level security.** If two viewers must see different numbers,
  they need different dashboards or an API that filters by the caller's identity.
- **Do not inline sensitive rows.** `inline`, `csv` and `json` data is baked into
  the HTML at build time. Aggregate before you publish.

## What the compiler does for you

- Spec JSON embedded in the page is escaped so it cannot break out of the
  `<script>` tag.
- Titles, labels and text are escaped on render; the YAML cannot inject script.
- `markdown` widgets support a small formatting subset, not arbitrary HTML.
- No `eval`, no remote code execution path from the YAML: there is deliberately
  no way to express JavaScript in the DSL.
- The only external request in a default build is the ECharts CDN script; use
  `--vendor ./echarts.min.js` for a build that makes none.

## Reporting a vulnerability

Open a private GitHub security advisory on the repository (Security → Report a
vulnerability). If advisories are unavailable to you, open an issue titled
"security contact request" with no details and a maintainer will reach out.
Please include the YAML that reproduces it and what an attacker gains. Expect a
first response within a few days.

Please do not open a public issue for anything that lets a dashboard's YAML
execute code in a viewer's browser.
