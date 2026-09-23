# Publishing yadash for adoption

The goal is not stars. The goal is that someone who has never heard of this can
go from curiosity to a working dashboard in under two minutes, in whichever
agent they already use. Everything below is ordered by that.

## Phase 0 — be installable three ways (before telling anyone)

**Status (2026-09-23):** repo history is pushed to `blcrosbie/yadash` on GitHub
(origin remote already points there). `npm whoami` confirms you're logged in
as `blcrosbie`. The npm registry has never had a `yadash` package, so the name
is free.

**`npm publish` from the CLI is currently blocked by npm's own 2026 2FA
lockdown**, not by anything in this repo: npm is phasing out direct publishing
from both bypass-2FA granular tokens and the old inline-OTP prompt (full
removal of bypass-2FA direct publish is targeted for January 2027, and in
practice the inline OTP prompt on `npm publish` did not appear at all for this
account — it 403'd immediately with `Two-factor authentication or granular
access token with bypass 2fa enabled is required to publish packages`). The
npm-recommended replacement is **Trusted Publishing (OIDC)**: GitHub Actions
publishes directly, authenticated by a short-lived token npm issues per run —
no npm token stored anywhere, ever. `.github/workflows/publish.yml` in this
repo is already wired up for it (triggers on `v*` tags or manual dispatch).

The catch: npm will not let you configure a Trusted Publisher for a package
that doesn't exist on the registry yet, so the very first publish has to be
done by hand with a token. Bootstrap it once, then never touch a token again:

1. **Create a short-lived bootstrap token.** npmjs.com → Profile → Access
   Tokens → Generate New Token → Granular Access Token → Read and write →
   scope it to the `yadash` package (or "All packages" if `yadash` isn't
   selectable yet, since it doesn't exist) → set the shortest expiry offered →
   check **Bypass 2FA for token-based write actions**. Copy the token.
2. **Publish once, locally, with that token** (PowerShell — run each line
   separately, `&&` isn't valid PowerShell syntax):
   ```powershell
   cd C:\Users\bcros\dev\blcrosbie\yadash
   npm test
   npm run validate:examples
   "//registry.npmjs.org/:_authToken=PASTE_TOKEN_HERE" | Out-File -Encoding ascii -Append .npmrc
   npm publish --access public
   Remove-Item .npmrc
   ```
   `.npmrc` is gitignored, but delete it anyway right after — don't leave the
   token sitting on disk.
3. **Revoke the bootstrap token immediately** on npmjs.com (Access Tokens →
   delete). It only ever needed to exist for step 2.
4. **Configure Trusted Publishing** on npmjs.com, now that `yadash` exists:
   package page → Settings → Trusted Publisher → GitHub Actions →
   organization/user `blcrosbie`, repository `yadash`, workflow filename
   `publish.yml`.
5. **Smoke-test the install**, same as ever:
   ```powershell
   npx yadash@latest init smoke
   npx yadash@latest build smoke.yaml -o C:\Users\bcros\AppData\Local\Temp\smoke
   ```
   That's the real test: it proves `npx` works for a stranger with an empty
   cache.

From here on, every release is: bump the version, tag it, push the tag —
`publish.yml` does the rest with zero tokens involved:

```powershell
git tag v0.1.0
git push --tags
```

Then draw a GitHub Release from that tag using `CHANGELOG.md`'s `0.1.0` notes.

Adoption dies at the install step. Cover the three shapes of user:

| user | install | needs |
|---|---|---|
| "just give me the CLI" | `npx yadash init sales` | npm publish |
| Claude Code user | `/plugin marketplace add blcrosbie/yadash` then `/plugin install yadash@blcrosbie` | `.claude-plugin/{plugin,marketplace}.json` ✅ |
| Codex / other agent | `codex plugin marketplace add blcrosbie/yadash`, or `npx yadash skill install --codex` | root `plugin.json` + `skills/` ✅ |

The repo already carries all three manifests. What is left:

1. **Publish to npm.** `yadash` is the name the docs assume, so check it is free
   (`npm view yadash`) before anything else; if taken, rename now, not later —
   the name is in the skill, the README, and every install line.
   ```bash
   npm whoami                 # or: npm login
   npm test && npm run validate:examples
   npm publish --access public
   npx yadash@latest init smoke && npx yadash@latest build smoke.yaml -o /tmp/smoke
   ```
   That last line is the real test: it proves `npx` works for a stranger with an
   empty cache.
2. **Tag the release.** `git tag v0.1.0 && git push --tags`, then a GitHub
   Release with the same notes as `CHANGELOG.md`. Plugin marketplaces and skill
   directories read tags and releases to decide whether a repo is alive.
3. **Verify the plugin install paths yourself**, in a scratch directory:
   `claude --plugin-dir .` for the Claude side, `npx yadash skill install --codex`
   for the Codex side. A broken install line in a launch post is unrecoverable.

## Phase 1 — the 60-second proof

Nobody installs anything to evaluate an idea. Give them the proof first.

1. **Live demo on GitHub Pages.** `.github/workflows/demo.yml` already builds
   every example and deploys it. Enable Pages (Settings → Pages → Source:
   GitHub Actions), push, then put the URL in the first screen of the README and
   in the repo's About box. One click, a real dashboard, no signup.
2. **One 20-second screen recording**, top of the README, showing exactly this:
   a YAML file on the left, the dashboard on the right, you type "make the rep
   table full width and flag anything under 50%", the diff is six lines, the
   page updates. That clip *is* the pitch. Keep it under 3 MB so it plays inline
   on GitHub.
3. **A copy-paste quickstart in three lines**, which the README has. No
   prerequisites section above it, no philosophy above it.

Do not announce anything until 1 and 2 exist. The demo is the product for the
first thousand people who see it.

## Phase 2 — be findable

- **GitHub topics**: `dashboard`, `dashboards-as-code`, `yaml`, `bi`,
  `analytics`, `claude-skill`, `agent-skills`, `codex`, `mcp`, `echarts`,
  `static-site`, `embed`. Topics are how the directory scrapers find you.
- **About box**: one sentence plus the demo URL. This is the text that gets
  quoted everywhere.
- **npm keywords** (already in `package.json`) and a README that renders on the
  npm page — npm strips HTML, so keep the hero in Markdown.
- **`SKILL.md` frontmatter description is your SEO for agents.** It decides
  whether the skill triggers at all, so it lists the trigger phrasings real
  users type ("add a filter", "make this a bar chart", "embeddable dashboard for
  WordPress"). Re-read it after every feature; a skill that never triggers is
  a skill nobody has.
- **Skill and plugin directories**: the ecosystem has community catalogs that
  index public `SKILL.md` repos and plugin marketplaces (Agent Skills / Agent
  Plugins directories, the various awesome-lists, the Claude Code plugin
  directories). Submit to the three or four with actual traffic, and follow each
  one's PR template rather than opening a drive-by PR. This is 30 minutes of
  work for the highest-quality traffic you will get.
- **`CITATION`-style anchors**: a versioned schema URL
  (`https://yadash.dev/schema/v0.1/dashboard.schema.json`) makes the YAML
  editor-aware via `# yaml-language-server: $schema=` and gives blogs something
  stable to link. Host it (Pages, a redirect) before you promote the comment
  line that references it.

## Phase 3 — where to post, in order

Lead with the artifact, never with the idea. Each post shows the YAML → page
diff, links the live demo, and says plainly what it does not do.

1. **Show HN** — "Show HN: yadash — dashboards as YAML, compiled to one static
   HTML file". Ship-day audience, technical, allergic to overclaiming. Post
   Tuesday–Thursday morning US Eastern, then sit in the thread for six hours and
   answer everything, including the hostile comments about YAML.
2. **r/BusinessIntelligence, r/dataengineering, r/PowerBI, r/tableau** — frame
   it as "BI-as-code for people whose company will never buy the enterprise
   tier". Read each subreddit's self-promotion rule first; several require you to
   participate before posting your own project.
3. **r/ClaudeAI, r/ChatGPTCoding, the Claude Code and Codex communities** — the
   angle here is the *agent* story, not the charts: "a constrained DSL an agent
   can edit safely, so it stops generating 4,000 lines of JSX."
4. **LinkedIn**, once, with the recording — this is where the BI analysts who
   are your actual users live, and where consulting leads come from.
5. **A written post** (dev.to / your blog, cross-posted): *Why dashboards should
   be configuration*. Argument, then demo, then the honest limits. This is the
   thing people link to six months later.
6. **Targeted, not broadcast**: open a thoughtful issue or discussion in
   adjacent communities where a yadash adapter would help (Rill, Metabase,
   Superset, Observable Framework), offering interop rather than competition.

Skip Product Hunt until there is a hosted option to convert to; it rewards
products with a signup, and yadash deliberately has none.

## Phase 4 — trust signals that convert a visitor into a user

- CI badge, green, running on 18/20/22 (`.github/workflows/ci.yml` ✅).
- `CHANGELOG.md` with real entries, and semver you actually honor. `version: 1`
  in the YAML is a promise: v0.x may change the schema, and the README should
  say so plainly.
- `LICENSE` — MIT ✅. Permissive matters for the WordPress/agency crowd.
- `SECURITY.md` with one honest paragraph: compiled dashboards are public files,
  never put credentials in the YAML, here is how to report a problem. The
  validator already warns about pasted tokens; say so.
- `CONTRIBUTING.md` that is three sentences and one command (`npm test`).
  Zero dependencies is a contribution feature — say it.
- **Issue templates** for "dashboard won't build" that ask for the YAML and the
  `--json` output. Cheap, and it makes your triage ten times faster.
- Answer every issue within 24 hours for the first month. Nothing kills a new
  tool faster than a stale first issue, and nothing sells it faster than a
  maintainer who replies.

## Phase 5 — the flywheel: adapters and embeds

Wide adoption comes from meeting people inside the tool they already use. In
rough order of effort-to-payoff:

1. **A WordPress plugin** that registers a Gutenberg block wrapping a built
   dashboard folder in an iframe. WordPress is where the non-technical long tail
   lives, and "add block → yadash Dashboard → pick one" is a story no BI tool
   can tell. This is the single highest-leverage thing after launch.
2. **A `yadash` GitHub Action** (`uses: blcrosbie/yadash@v1`) that
   validates on PR and deploys on merge. It turns "I tried it" into "it's in our
   pipeline", which is where retention comes from.
3. **An importer**: `yadash import <superset|metabase|powerbi>` that converts an
   existing dashboard export into YAML, however imperfectly. Import beats
   evangelism — people adopt what does not ask them to start over.
4. **An exporter** to Rill Canvas YAML or PBIR. It reframes yadash as the
   vendor-neutral middle layer rather than a competitor, and that is the framing
   that gets you into other people's docs.
5. **A hosted option, last.** Only once people are asking where to put the
   output. Static output means hosting is a business decision, not a technical
   prerequisite — keep it that way as long as possible.

## Phase 6 — measure the right things

- **Signal**: `npx` invocations (npm download counts for a CLI are mostly `npx`),
  plugin installs, issues opened by strangers, forks with real commits,
  dashboards found in the wild via GitHub code search for
  `yaml-language-server: $schema=https://yadash.dev`.
- **Noise**: stars, one-day HN traffic, follower counts.
- **The number that matters**: how many people ran `build` twice. If they built
  once and never came back, the tool is a demo, not a product. Ask the first
  twenty users directly; five replies will tell you what the next release is.

## Anti-patterns

- **Launching before the demo link works.** You get one first impression per
  channel.
- **Overselling it as a Power BI replacement.** The README's "what yadash is
  not" section earns more trust than any feature list, and the BI crowd will
  test the ceiling within ten minutes.
- **Adding a JavaScript escape hatch** because an early user asked. The moment
  YAML can express arbitrary chart-library options, the agent story dies and you
  have rebuilt frontend programming in a worse language.
- **Building the platform before the format.** The DSL plus the skill is the
  product; auth, tenancy, and a dashboard server are what you sell later, if at
  all.
- **Renaming after launch.** Settle the name (and the npm package) in Phase 0.
