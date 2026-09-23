---
description: Create or change a yadash dashboard from a plain-English description
argument-hint: [what the dashboard should show, or what to change]
---

Use the `yadash` skill for this.

Request: $ARGUMENTS

1. If no dashboard YAML is named or obvious in the working directory, find the
   candidates (`*.yaml` files whose first lines contain `dashboard:`) and ask
   which one, unless there is exactly one.
2. If this is a new dashboard and no data exists yet, ask what the data source
   is (CSV path, JSON file, or API URL) before writing anything. Do not invent
   field names — read the actual file's header, or ask.
3. Make the smallest edit that satisfies the request.
4. Run `yadash validate <file> --json --strict` and fix every error and warning.
5. Run `yadash build <file> -o dist/<id>`.
6. Report: what changed (by widget id), the output path, and the one-liner to
   preview it (`npx @blcrosbie/yadash dev <file>`).
