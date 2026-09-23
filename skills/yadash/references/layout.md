# Layout

```yaml
layout:
  columns: 12       # 1-24, default 12
  gap: 16           # px between tiles, default 16
  row_height: 64    # px per height unit, default 64
  max_width: 1400   # px, centred; omit for full width
```

Each widget places itself with `position: [column, row]` (1-based) and
`size: [width, height]` in grid units. Height unit = `row_height`, so
`size: [4, 5]` on the defaults is a tile 4 columns wide and 320px tall.

## Auto-flow vs explicit

Omit `position`/`size` and widgets flow left to right, wrapping when they run
out of columns, using per-type defaults (`kpi` a quarter-width by 2,
`markdown` full width, everything else half-width by 5).

Auto-flow is for a first draft. Once the user has an opinion about arrangement,
write explicit `position` and `size` on every widget — mixing the two is where
surprise gaps come from, because an explicit position resets the flow cursor to
the next free row.

## The grid arithmetic you will actually do

On a 12-column grid:

- 4 KPIs across: `size: [3, 2]` at columns 1, 4, 7, 10.
- 3 KPIs across: `size: [4, 2]` at columns 1, 5, 9.
- Trend + side table: `[8, 5]` at column 1, `[4, 5]` at column 9.
- Two half-width charts: `[6, 5]` at columns 1 and 7.
- Full-width table: `[12, 5]` at column 1.

A widget must satisfy `column + width - 1 <= columns` or it is a build error
with a suggested position in the hint. Overlaps are a warning naming both
widgets — always fix them; overlapping tiles stack in the same cells and the
page looks broken.

## Moving things

"Put the table under the trend, full width" means: give the table
`position: [1, <row after the trend>]` and `size: [12, 5]`, then push every
widget that used to live below it down by the difference in height. Do the
arithmetic, do not guess, and re-validate — overlap warnings are your check.

Rows do not need to be contiguous; leaving a gap simply leaves whitespace.
Keeping row numbers in ascending document order makes the file readable, so
reorder list entries to match visual order when you move something a long way.

## Responsive behaviour

The compiled page collapses the grid on narrow screens: tiles stack in document
order at phone width. That is another reason to keep the widget list in reading
order — the mobile layout *is* the document order.

## Theme and accent

`theme: auto` follows the viewer's OS setting (both palettes are designed, and
charts re-render on change). `theme: light`/`dark` pins it. `accent: "#2f6df6"`
overrides the first series colour and the highlight colour; the rest of the
palette follows.

A host page can flip the theme at runtime without a rebuild:
`window.yadash.setTheme('dark')`. See `references/deploy.md`.
