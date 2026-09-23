/* yadash runtime - renders a compiled dashboard spec in the browser.
 *
 * The contract with the YAML is: the spec says *what* to show, this file owns
 * *how*. Chart libraries, axis formatting, colour, layout and interaction all
 * live here so the config never has to describe them.
 *
 * Globals: window.__YADASH_SPEC__ (injected by the compiler), echarts (CDN).
 */
(function () {
  'use strict';

  var spec = window.__YADASH_SPEC__;
  if (!spec) return;

  var SERIES_SLOTS = ['--yd-s1', '--yd-s2', '--yd-s3', '--yd-s4', '--yd-s5', '--yd-s6', '--yd-s7', '--yd-s8'];
  var MS_DAY = 86400000;

  var state = {
    data: {},          // source name -> rows
    errors: {},        // source name -> message
    filters: {},       // filter id -> value
    charts: [],        // { widget, instance, el }
    booted: false,
  };

  /* ------------------------------------------------------------- utilities */

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  function palette() { return SERIES_SLOTS.map(css); }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function defaultSource() { return Object.keys(spec.data || {})[0]; }
  function metricDef(name) { return (spec.metrics || {})[name] || null; }
  function metricLabel(name) {
    var m = metricDef(name);
    return (m && m.label) || titleize(name);
  }
  function titleize(s) {
    return String(s).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function sourceFor(widget, metricName) {
    if (widget && widget.source) return widget.source;
    var m = metricName ? metricDef(metricName) : null;
    if (m && m.source) return m.source;
    return defaultSource();
  }

  function toDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    var s = String(value).trim();
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T00:00:00' : s);
    return isNaN(d.getTime()) ? null : d;
  }

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function bucketKey(value, bucket) {
    var d = toDate(value);
    if (!d) return null;
    var y = d.getFullYear();
    switch (bucket) {
      case 'hour': return y + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':00';
      case 'week': {
        var start = new Date(d);
        var day = (d.getDay() + 6) % 7; // Monday = 0
        start.setDate(d.getDate() - day);
        return start.getFullYear() + '-' + pad(start.getMonth() + 1) + '-' + pad(start.getDate());
      }
      case 'month': return y + '-' + pad(d.getMonth() + 1);
      case 'quarter': return y + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
      case 'year': return String(y);
      case 'day':
      default: return y + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }

  function num(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === null || value === undefined || value === '') return null;
    var n = Number(String(value).replace(/[$,\s%]/g, ''));
    return isFinite(n) ? n : null;
  }

  /* ------------------------------------------------------------ formatting */

  function formatValue(value, format, opts) {
    opts = opts || {};
    if (value === null || value === undefined || (typeof value === 'number' && !isFinite(value))) return '--';
    if (format === 'date' || typeof value === 'string') return String(value);
    var decimals = opts.decimals;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: opts.currency || 'USD',
          maximumFractionDigits: decimals !== undefined ? decimals : (Math.abs(value) >= 1000 ? 0 : 2),
        }).format(value);
      case 'percent':
        return (value * 100).toFixed(decimals !== undefined ? decimals : (Math.abs(value * 100) >= 10 ? 0 : 1)) + '%';
      case 'compact':
        return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: decimals !== undefined ? decimals : 1 }).format(value);
      case 'duration': {
        var total = Math.round(value);
        var h = Math.floor(total / 3600);
        var m = Math.floor((total % 3600) / 60);
        var s = total % 60;
        return h ? h + 'h ' + m + 'm' : m ? m + 'm ' + s + 's' : s + 's';
      }
      default:
        return new Intl.NumberFormat(undefined, {
          maximumFractionDigits: decimals !== undefined ? decimals : (Math.abs(value) >= 100 ? 0 : 2),
        }).format(value);
    }
  }

  function formatMetric(value, metricName, override) {
    var m = metricDef(metricName) || {};
    return formatValue(value, override || m.format || 'number', { decimals: m.decimals, currency: m.currency });
  }

  /* --------------------------------------------------------------- filters */

  function fieldExists(rows, field) {
    for (var i = 0; i < Math.min(rows.length, 50); i++) {
      if (rows[i] && Object.prototype.hasOwnProperty.call(rows[i], field)) return true;
    }
    return rows.length === 0;
  }

  function matchWhere(row, conditions) {
    if (!conditions) return true;
    for (var i = 0; i < conditions.length; i++) {
      var c = conditions[i];
      var v = row[c.field];
      var target = c.value;
      switch (c.op || 'eq') {
        case 'ne': if (v == target) return false; break;
        case 'gt': if (!(num(v) > num(target))) return false; break;
        case 'gte': if (!(num(v) >= num(target))) return false; break;
        case 'lt': if (!(num(v) < num(target))) return false; break;
        case 'lte': if (!(num(v) <= num(target))) return false; break;
        case 'in': if (!Array.isArray(target) || target.indexOf(v) === -1) return false; break;
        case 'not_in': if (Array.isArray(target) && target.indexOf(v) !== -1) return false; break;
        case 'contains': if (String(v == null ? '' : v).toLowerCase().indexOf(String(target).toLowerCase()) === -1) return false; break;
        case 'is_null': if (!(v === null || v === undefined || v === '')) return false; break;
        case 'not_null': if (v === null || v === undefined || v === '') return false; break;
        default: if (v != target) return false;
      }
    }
    return true;
  }

  function activeDateRange() {
    var filters = spec.filters || [];
    for (var i = 0; i < filters.length; i++) {
      if (filters[i].type === 'date_range') {
        var v = state.filters[filters[i].id];
        if (v && (v.from || v.to)) return { field: filters[i].field, from: v.from, to: v.to };
      }
    }
    return null;
  }

  function filteredRows(sourceName, extraWhere, dateShift) {
    var rows = state.data[sourceName] || [];
    var filters = spec.filters || [];
    var out = rows;
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (f.source && f.source !== sourceName) continue;
      if (!fieldExists(rows, f.field)) continue;
      var value = state.filters[f.id];
      if (value === undefined || value === null || value === '' || value === '__all__') continue;
      out = applyFilter(out, f, value, dateShift);
    }
    if (extraWhere) out = out.filter(function (r) { return matchWhere(r, extraWhere); });
    return out;
  }

  function applyFilter(rows, filter, value, dateShift) {
    if (filter.type === 'multiselect') {
      if (!Array.isArray(value) || value.length === 0) return rows;
      return rows.filter(function (r) { return value.indexOf(String(r[filter.field])) !== -1; });
    }
    if (filter.type === 'search') {
      var needle = String(value).toLowerCase();
      return rows.filter(function (r) { return String(r[filter.field] == null ? '' : r[filter.field]).toLowerCase().indexOf(needle) !== -1; });
    }
    if (filter.type === 'date_range') {
      var from = value.from ? toDate(value.from) : null;
      var to = value.to ? toDate(value.to) : null;
      if (dateShift && from && to) {
        var span = to - from;
        to = new Date(from.getTime() - MS_DAY);
        from = new Date(from.getTime() - span - MS_DAY);
      } else if (dateShift) {
        return rows;
      }
      if (to) to = new Date(to.getTime() + MS_DAY - 1);
      return rows.filter(function (r) {
        var d = toDate(r[filter.field]);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }
    return rows.filter(function (r) { return String(r[filter.field]) === String(value); });
  }

  /* ----------------------------------------------------------- aggregation */

  function aggregate(rows, metricName) {
    var m = metricDef(metricName);
    if (!m) return null;
    var subset = m.where ? rows.filter(function (r) { return matchWhere(r, m.where); }) : rows;
    switch (m.agg) {
      case 'count': return subset.length;
      case 'distinct_count': {
        var seen = Object.create(null);
        var n = 0;
        for (var i = 0; i < subset.length; i++) {
          var k = String(subset[i][m.field]);
          if (!(k in seen)) { seen[k] = 1; n++; }
        }
        return n;
      }
      case 'ratio': {
        var top = 0, bottom = 0;
        for (var j = 0; j < subset.length; j++) {
          top += num(subset[j][m.field]) || 0;
          bottom += num(subset[j][m.of]) || 0;
        }
        return bottom === 0 ? null : top / bottom;
      }
      default: {
        var values = [];
        for (var k2 = 0; k2 < subset.length; k2++) {
          var v = num(subset[k2][m.field]);
          if (v !== null) values.push(v);
        }
        if (values.length === 0) return m.agg === 'sum' ? 0 : null;
        if (m.agg === 'sum') return values.reduce(function (a, b) { return a + b; }, 0);
        if (m.agg === 'avg') return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
        if (m.agg === 'min') return Math.min.apply(null, values);
        if (m.agg === 'max') return Math.max.apply(null, values);
        return null;
      }
    }
  }

  function dimensionKey(row, dim) {
    var raw = row[dim.field];
    if (dim.bucket) return bucketKey(raw, dim.bucket);
    if (raw === null || raw === undefined || raw === '') return '(none)';
    return String(raw);
  }

  function groupRows(rows, dim) {
    var map = new Map();
    for (var i = 0; i < rows.length; i++) {
      var key = dimensionKey(rows[i], dim);
      if (key === null) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rows[i]);
    }
    return map;
  }

  function orderedKeys(map, dim, rankMetric) {
    var keys = Array.from(map.keys());
    if (dim.bucket) {
      keys.sort();
    } else if (rankMetric) {
      keys.sort(function (a, b) { return (aggregate(map.get(b), rankMetric) || 0) - (aggregate(map.get(a), rankMetric) || 0); });
    } else {
      keys.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    }
    if (dim.limit && keys.length > dim.limit) {
      var kept = keys.slice(0, dim.limit);
      var rest = keys.slice(dim.limit);
      var other = [];
      rest.forEach(function (k) { other = other.concat(map.get(k)); });
      rest.forEach(function (k) { map.delete(k); });
      map.set('Other', other);
      kept.push('Other');
      return kept;
    }
    return keys;
  }

  /* -------------------------------------------------------------- shell UI */

  function boot() {
    document.body.innerHTML = '';
    var app = el('div', 'yd-app');
    if (spec.layout && spec.layout.max_width) app.style.setProperty('--yd-max', spec.layout.max_width + 'px');

    if (!spec.embed) {
      var header = el('div', 'yd-header');
      header.appendChild(el('h1', 'yd-title', spec.title));
      if (spec.description) header.appendChild(el('p', 'yd-subtitle', spec.description));
      app.appendChild(header);
    }

    if ((spec.filters || []).length) app.appendChild(buildFilterBar());

    var grid = el('div', 'yd-grid');
    grid.style.setProperty('--yd-cols', (spec.layout && spec.layout.columns) || 12);
    grid.style.setProperty('--yd-gap', ((spec.layout && spec.layout.gap) || 16) + 'px');
    grid.style.setProperty('--yd-row', ((spec.layout && spec.layout.row_height) || 64) + 'px');
    app.appendChild(grid);
    state.grid = grid;

    var footer = el('div', 'yd-footer');
    footer.appendChild(el('span', null, 'Built from ' + (spec.sourceFile || 'dashboard.yaml') + ' with yadash'));
    if (spec.builtAt) footer.appendChild(el('span', null, 'Compiled ' + spec.builtAt));
    app.appendChild(footer);

    document.body.appendChild(app);
    renderAll();
  }

  function buildFilterBar() {
    var bar = el('div', 'yd-filters');
    (spec.filters || []).forEach(function (f) {
      var wrap = el('div', 'yd-filter');
      wrap.appendChild(el('label', null, f.label || titleize(f.field)));
      if (f.type === 'date_range') {
        var group = el('div', 'yd-filter-dates');
        var from = el('input');
        var to = el('input');
        from.type = 'date';
        to.type = 'date';
        var cur = state.filters[f.id] || {};
        from.value = cur.from || '';
        to.value = cur.to || '';
        function onDate() {
          state.filters[f.id] = { from: from.value || null, to: to.value || null };
          onFilterChange();
        }
        from.addEventListener('change', onDate);
        to.addEventListener('change', onDate);
        group.appendChild(from);
        group.appendChild(to);
        wrap.appendChild(group);
      } else if (f.type === 'search') {
        var input = el('input');
        input.type = 'search';
        input.placeholder = 'Search ' + (f.label || f.field);
        input.value = state.filters[f.id] || '';
        input.addEventListener('input', debounce(function () {
          state.filters[f.id] = input.value;
          onFilterChange();
        }, 200));
        wrap.appendChild(input);
      } else {
        var select = el('select');
        select.multiple = f.type === 'multiselect';
        if (f.type === 'multiselect') select.size = 1;
        var options = f.options || derivedOptions(f);
        if (f.type !== 'multiselect') {
          var all = el('option', null, 'All');
          all.value = '__all__';
          select.appendChild(all);
        }
        options.forEach(function (opt) {
          var o = el('option', null, String(opt));
          o.value = String(opt);
          select.appendChild(o);
        });
        var current = state.filters[f.id];
        if (f.type === 'multiselect' && Array.isArray(current)) {
          Array.prototype.forEach.call(select.options, function (o) { o.selected = current.indexOf(o.value) !== -1; });
        } else if (current !== undefined && current !== null) {
          select.value = String(current);
        } else {
          select.value = '__all__';
        }
        select.addEventListener('change', function () {
          state.filters[f.id] = f.type === 'multiselect'
            ? Array.prototype.filter.call(select.options, function (o) { return o.selected; }).map(function (o) { return o.value; })
            : select.value;
          onFilterChange();
        });
        wrap.appendChild(select);
      }
      bar.appendChild(wrap);
    });

    var reset = el('button', 'yd-reset', 'Reset');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      state.filters = defaultFilterState();
      writeUrl();
      document.querySelector('.yd-filters').replaceWith(buildFilterBar());
      renderAll();
    });
    bar.appendChild(reset);
    return bar;
  }

  function derivedOptions(f) {
    var source = f.source || defaultSource();
    var rows = state.data[source] || [];
    var seen = Object.create(null);
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var v = rows[i][f.field];
      if (v === null || v === undefined || v === '') continue;
      var key = String(v);
      if (!(key in seen)) { seen[key] = 1; out.push(key); }
    }
    return out.sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
  }

  function defaultFilterState() {
    var out = {};
    (spec.filters || []).forEach(function (f) {
      if (f.default !== undefined && f.default !== null) out[f.id] = f.default;
      else if (f.type === 'multiselect') out[f.id] = [];
      else if (f.type === 'date_range') out[f.id] = {};
      else out[f.id] = '__all__';
    });
    return out;
  }

  function onFilterChange() {
    writeUrl();
    renderAll();
  }

  function writeUrl() {
    try {
      var params = new URLSearchParams();
      Object.keys(state.filters).forEach(function (id) {
        var v = state.filters[id];
        if (v === undefined || v === null || v === '' || v === '__all__') return;
        if (Array.isArray(v)) { if (v.length) params.set(id, v.join('|')); return; }
        if (typeof v === 'object') {
          if (v.from || v.to) params.set(id, (v.from || '') + '..' + (v.to || ''));
          return;
        }
        params.set(id, String(v));
      });
      var qs = params.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (e) { /* embedded in a sandboxed iframe - not fatal */ }
  }

  function readUrl() {
    var out = defaultFilterState();
    try {
      var params = new URLSearchParams(location.search);
      (spec.filters || []).forEach(function (f) {
        if (!params.has(f.id)) return;
        var raw = params.get(f.id);
        if (f.type === 'multiselect') out[f.id] = raw.split('|').filter(Boolean);
        else if (f.type === 'date_range') {
          var parts = raw.split('..');
          out[f.id] = { from: parts[0] || null, to: parts[1] || null };
        } else out[f.id] = raw;
      });
    } catch (e) { /* ignore */ }
    return out;
  }

  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  /* --------------------------------------------------------------- widgets */

  function renderAll() {
    state.charts.forEach(function (c) { if (c.instance) c.instance.dispose(); });
    state.charts = [];
    state.grid.innerHTML = '';
    (spec.widgets || []).forEach(function (w) { state.grid.appendChild(renderWidget(w)); });
    resizeCharts();
  }

  function renderWidget(w) {
    var node = el('div', 'yd-widget');
    node.setAttribute('data-type', w.type);
    if (w.id) node.id = 'w-' + w.id;
    if (w.position && w.size) {
      node.style.gridColumn = w.position[0] + ' / span ' + w.size[0];
      node.style.gridRow = w.position[1] + ' / span ' + w.size[1];
    } else if (w.size) {
      node.style.gridColumn = 'span ' + w.size[0];
      node.style.gridRow = 'span ' + w.size[1];
    }
    if (w.title) node.appendChild(el('h2', 'yd-widget-title', w.title));
    if (w.subtitle) node.appendChild(el('p', 'yd-widget-subtitle', w.subtitle));

    var body = el('div', 'yd-widget-body');
    node.appendChild(body);

    try {
      if (w.type === 'markdown') renderMarkdown(body, w);
      else if (w.type === 'kpi') renderKpi(node, body, w);
      else if (w.type === 'table') renderTable(body, w);
      else renderChart(body, w);
    } catch (err) {
      body.appendChild(el('div', 'yd-empty yd-error', 'Could not render "' + (w.id || w.type) + '": ' + err.message));
    }
    return node;
  }

  function emptyState(body, w, message) {
    body.appendChild(el('div', 'yd-empty', w.empty_message || message || 'No data for the current filters'));
  }

  function stateFor(value, thresholds) {
    if (value === null || value === undefined || !thresholds) return null;
    for (var i = 0; i < thresholds.length; i++) {
      var t = thresholds[i];
      if (t.below !== undefined && value < t.below) return t;
      if (t.above !== undefined && value > t.above) return t;
    }
    return null;
  }

  function renderKpi(node, body, w) {
    node.classList.add('yd-kpi-card');
    var source = sourceFor(w, w.metric);
    var rows = filteredRows(source, w.where);
    var value = aggregate(rows, w.metric);
    var wrap = el('div', 'yd-kpi');
    wrap.appendChild(el('div', 'yd-kpi-value', formatMetric(value, w.metric, w.format)));

    var meta = el('div', 'yd-kpi-meta');
    if (w.compare === 'previous_period' && activeDateRange()) {
      var prev = aggregate(filteredRows(source, w.where, true), w.metric);
      if (prev !== null && prev !== 0 && value !== null) {
        var change = (value - prev) / Math.abs(prev);
        var delta = el('span', 'yd-delta', (change >= 0 ? '▲ ' : '▼ ') + formatValue(Math.abs(change), 'percent', { decimals: 1 }));
        delta.setAttribute('data-dir', change >= 0 ? 'up' : 'down');
        meta.appendChild(delta);
        meta.appendChild(el('span', null, 'vs previous period'));
      }
    }
    if (w.target !== undefined && value !== null) {
      meta.appendChild(el('span', null, 'target ' + formatMetric(w.target, w.metric, w.format)));
    }
    var hit = stateFor(value, w.thresholds);
    if (hit) {
      var badge = el('span', 'yd-state');
      badge.setAttribute('data-state', hit.state);
      badge.appendChild(el('span', 'yd-state-dot'));
      badge.appendChild(el('span', null, hit.label || titleize(hit.state)));
      meta.appendChild(badge);
    }
    if (meta.childNodes.length) wrap.appendChild(meta);
    body.appendChild(wrap);
    if (rows.length === 0) wrap.appendChild(el('div', 'yd-widget-subtitle', 'no matching rows'));
  }

  function renderMarkdown(body, w) {
    var div = el('div', 'yd-markdown');
    div.innerHTML = miniMarkdown(w.text || '');
    body.appendChild(div);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function miniMarkdown(text) {
    var html = escapeHtml(text)
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>')
      .replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
    return html.split(/\n{2,}/).map(function (block) {
      return /^<(h\d|ul|li|p)/.test(block.trim()) ? block : '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderTable(body, w) {
    var dims = w.dimensions || (w.dimension ? [w.dimension] : []);
    var metrics = w.metrics || [];
    var source = sourceFor(w, metrics[0]);
    var rows = filteredRows(source, w.where);
    if (rows.length === 0) return emptyState(body, w);

    var groups = new Map();
    rows.forEach(function (row) {
      var key = dims.map(function (d) { return dimensionKey(row, d); }).join('\u0000');
      if (!groups.has(key)) groups.set(key, { keys: dims.map(function (d) { return dimensionKey(row, d); }), rows: [] });
      groups.get(key).rows.push(row);
    });

    var records = Array.from(groups.values()).map(function (g) {
      var rec = { _keys: g.keys };
      dims.forEach(function (d, i) { rec[d.field] = g.keys[i]; });
      metrics.forEach(function (m) { rec[m] = aggregate(g.rows, m); });
      return rec;
    });

    var sortBy = w.sort ? w.sort.by : metrics[0];
    var dir = w.sort && w.sort.direction === 'asc' ? 1 : -1;
    if (sortBy) {
      records.sort(function (a, b) {
        var av = a[sortBy], bv = b[sortBy];
        if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    }
    if (w.limit) records = records.slice(0, w.limit);

    var columns = w.columns || dims.map(function (d) { return { key: d.field, label: d.label || titleize(d.field), format: 'text' }; })
      .concat(metrics.map(function (m) { return { key: m, label: metricLabel(m) }; }));

    var maxima = {};
    columns.forEach(function (c) {
      if (!c.bar) return;
      maxima[c.key] = records.reduce(function (acc, r) { return Math.max(acc, Math.abs(num(r[c.key]) || 0)); }, 0);
    });

    var scroll = el('div', 'yd-table-scroll');
    var table = el('table', 'yd-table');
    var thead = el('thead');
    var hrow = el('tr');
    columns.forEach(function (c) {
      var isMetric = !!metricDef(c.key);
      var th = el('th', isMetric || c.align === 'right' ? 'num' : null, c.label || metricLabel(c.key));
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = el('tbody');
    records.forEach(function (rec) {
      var tr = el('tr');
      columns.forEach(function (c) {
        var isMetric = !!metricDef(c.key);
        var raw = rec[c.key];
        var text = isMetric
          ? formatMetric(raw, c.key, c.format === 'text' ? undefined : c.format)
          : formatValue(raw, c.format || 'text', { decimals: c.decimals });
        var td = el('td', isMetric || c.align === 'right' ? 'num' : null);
        var hit = stateFor(num(raw), c.thresholds || (isMetric ? null : null));
        if (c.bar && maxima[c.key]) {
          td.classList.add('yd-cell-bar');
          var fill = el('div', 'yd-cell-bar-fill');
          fill.style.width = Math.round((Math.abs(num(raw) || 0) / maxima[c.key]) * 100) + '%';
          td.appendChild(fill);
          td.appendChild(el('span', null, text));
        } else if (hit) {
          var badge = el('span', 'yd-state');
          badge.setAttribute('data-state', hit.state);
          badge.appendChild(el('span', 'yd-state-dot'));
          badge.appendChild(el('span', null, text));
          td.appendChild(badge);
        } else {
          td.textContent = text;
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    scroll.appendChild(table);
    body.appendChild(scroll);
  }

  /* ---------------------------------------------------------------- charts */

  function seriesMetrics(w) {
    if (w.y && w.y.metrics) return w.y.metrics;
    if (w.y && w.y.metric) return [w.y.metric];
    if (w.metrics) return w.metrics;
    if (w.metric) return [w.metric];
    return [];
  }

  function renderChart(body, w) {
    if (typeof echarts === 'undefined') {
      return emptyState(body, w, 'Chart library did not load - check the echarts <script> tag');
    }
    var metrics = seriesMetrics(w);
    var source = sourceFor(w, metrics[0]);
    var rows = filteredRows(source, w.where);
    if (rows.length === 0) return emptyState(body, w);

    var host = el('div', 'yd-chart');
    body.appendChild(host);
    var chart = echarts.init(host, null, { renderer: 'canvas' });
    var option = w.type === 'pie' || w.type === 'donut' ? pieOption(w, rows)
      : w.type === 'scatter' ? scatterOption(w, rows)
      : w.type === 'hbar' ? barOption(w, rows, true)
      : w.type === 'bar' || w.type === 'stacked_bar' ? barOption(w, rows, false)
      : lineOption(w, rows);
    chart.setOption(option);
    state.charts.push({ widget: w, instance: chart, el: host });
  }

  function chartBase(w) {
    var ink = css('--yd-ink');
    var muted = css('--yd-muted');
    return {
      color: palette(),
      animationDuration: 260,
      textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: ink },
      grid: { left: 8, right: 14, top: 28, bottom: 6, containLabel: true },
      tooltip: {
        backgroundColor: css('--yd-surface'),
        borderColor: css('--yd-border'),
        textStyle: { color: ink, fontSize: 12 },
        axisPointer: { type: 'line', lineStyle: { color: muted, width: 1 } },
      },
      legend: { show: false, top: 0, left: 0, itemWidth: 10, itemHeight: 10, icon: 'roundRect', textStyle: { color: css('--yd-ink-2'), fontSize: 12 } },
    };
  }

  function axisCommon(label, formatFn) {
    return {
      name: label || undefined,
      nameTextStyle: { color: css('--yd-muted'), fontSize: 11 },
      axisLine: { lineStyle: { color: css('--yd-axis') } },
      axisTick: { show: false },
      axisLabel: { color: css('--yd-muted'), fontSize: 11, hideOverlap: true, formatter: formatFn },
      splitLine: { lineStyle: { color: css('--yd-grid'), width: 1 } },
    };
  }

  function categories(w, rows, dim, rankMetric) {
    var map = groupRows(rows, dim);
    var keys = orderedKeys(map, dim, rankMetric);
    return { map: map, keys: keys };
  }

  function buildSeries(w, rows, dim) {
    // Returns { keys, series: [{ name, data }] }
    var metrics = seriesMetrics(w);
    var grouped = categories(w, rows, dim, w.type === 'hbar' || w.type === 'bar' ? metrics[0] : null);
    var keys = grouped.keys;
    var series = [];

    if (w.series && w.series.field) {
      var splitMap = groupRows(rows, w.series);
      var splitKeys = orderedKeys(splitMap, w.series, metrics[0]);
      splitKeys.forEach(function (sk) {
        var subset = splitMap.get(sk) || [];
        var byKey = groupRows(subset, dim);
        series.push({
          name: sk,
          metric: metrics[0],
          data: keys.map(function (k) { return byKey.has(k) ? aggregate(byKey.get(k), metrics[0]) : null; }),
        });
      });
    } else {
      metrics.forEach(function (m) {
        series.push({
          name: metricLabel(m),
          metric: m,
          data: keys.map(function (k) { return aggregate(grouped.map.get(k) || [], m); }),
        });
      });
    }
    return { keys: keys, series: series };
  }

  function valueFormatter(metricName, override) {
    return function (value) { return formatMetric(value, metricName, override); };
  }

  function lineOption(w, rows) {
    var dim = { field: w.x.field, bucket: w.x.bucket, limit: w.x.limit };
    var built = buildSeries(w, rows, dim);
    var primary = built.series[0] ? built.series[0].metric : null;
    var area = w.type === 'area';
    var base = chartBase(w);
    base.legend.show = built.series.length > 1 && w.show_legend !== false;
    base.grid.top = base.legend.show ? 30 : 16;
    base.tooltip.trigger = 'axis';
    base.tooltip.valueFormatter = valueFormatter(primary, w.y && w.y.format);
    base.xAxis = Object.assign(axisCommon(w.x.label), { type: 'category', data: built.keys, boundaryGap: false, splitLine: { show: false } });
    base.yAxis = Object.assign(axisCommon(w.y && w.y.label, function (v) { return formatMetric(v, primary, (w.y && w.y.format) || 'compact'); }), {
      type: 'value',
      min: w.y && w.y.min,
      max: w.y && w.y.max,
    });
    base.series = built.series.map(function (s, i) {
      return {
        name: s.name,
        type: 'line',
        data: s.data,
        smooth: !!w.smooth,
        symbol: 'circle',
        symbolSize: 8,
        showSymbol: built.keys.length <= 40,
        lineStyle: { width: 2 },
        itemStyle: { borderColor: css('--yd-surface'), borderWidth: 2 },
        areaStyle: area ? { opacity: 0.16 } : undefined,
        stack: area && built.series.length > 1 ? 'total' : undefined,
        label: w.show_labels ? { show: true, color: css('--yd-ink-2'), fontSize: 11, formatter: function (p) { return formatMetric(p.value, primary); } } : undefined,
      };
    });
    return base;
  }

  function barOption(w, rows, horizontal) {
    var dimSpec = horizontal ? (w.dimension || { field: w.y && w.y.field }) : { field: w.x.field, bucket: w.x.bucket, limit: w.x.limit };
    var built = buildSeries(w, rows, dimSpec);
    var primary = built.series[0] ? built.series[0].metric : null;
    var stacked = w.type === 'stacked_bar';
    var base = chartBase(w);
    base.legend.show = built.series.length > 1 && w.show_legend !== false;
    base.grid.top = base.legend.show ? 30 : 16;
    base.tooltip.trigger = 'axis';
    base.tooltip.axisPointer = { type: 'shadow' };
    base.tooltip.valueFormatter = valueFormatter(primary, w.format);

    var catAxis = Object.assign(axisCommon(horizontal ? (w.dimension && w.dimension.label) : w.x.label), {
      type: 'category',
      data: horizontal ? built.keys.slice().reverse() : built.keys,
      splitLine: { show: false },
    });
    var valAxis = Object.assign(axisCommon(w.y && w.y.label, function (v) { return formatMetric(v, primary, (w.y && w.y.format) || 'compact'); }), { type: 'value' });

    if (horizontal) { base.yAxis = catAxis; base.xAxis = valAxis; }
    else { base.xAxis = catAxis; base.yAxis = valAxis; }

    base.series = built.series.map(function (s) {
      var data = horizontal ? s.data.slice().reverse() : s.data;
      return {
        name: s.name,
        type: 'bar',
        data: data,
        stack: stacked ? 'total' : undefined,
        barMaxWidth: 36,
        itemStyle: {
          borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
          borderColor: stacked ? css('--yd-surface') : 'transparent',
          borderWidth: stacked ? 2 : 0,
        },
        label: w.show_labels ? { show: true, position: horizontal ? 'right' : 'top', color: css('--yd-ink-2'), fontSize: 11, formatter: function (p) { return formatMetric(p.value, primary); } } : undefined,
      };
    });
    return base;
  }

  function pieOption(w, rows) {
    var dim = w.dimension;
    var grouped = categories(w, rows, dim, w.metric);
    var base = chartBase(w);
    base.tooltip.trigger = 'item';
    base.tooltip.valueFormatter = valueFormatter(w.metric, w.format);
    base.legend.show = w.show_legend !== false;
    base.legend.orient = 'vertical';
    base.legend.left = 'left';
    base.legend.top = 'middle';
    base.series = [{
      type: 'pie',
      radius: w.type === 'donut' ? ['52%', '76%'] : ['0%', '72%'],
      center: base.legend.show ? ['66%', '52%'] : ['50%', '52%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: css('--yd-surface'), borderWidth: 2 },
      label: {
        show: w.show_labels !== false,
        color: css('--yd-ink-2'),
        fontSize: 11,
        formatter: function (p) { return p.name + '  ' + formatMetric(p.value, w.metric, w.format); },
      },
      labelLine: { lineStyle: { color: css('--yd-axis') } },
      data: grouped.keys.map(function (k) { return { name: k, value: aggregate(grouped.map.get(k) || [], w.metric) }; }),
    }];
    return base;
  }

  function scatterOption(w, rows) {
    var groupDim = w.series && w.series.field ? w.series : (w.dimension || (w.x.field ? { field: w.x.field } : null));
    var base = chartBase(w);
    base.tooltip.trigger = 'item';
    base.xAxis = Object.assign(axisCommon(w.x.label, function (v) { return formatMetric(v, w.x.metric, w.x.format || 'compact'); }), { type: 'value', scale: true });
    base.yAxis = Object.assign(axisCommon(w.y.label, function (v) { return formatMetric(v, w.y.metric, w.y.format || 'compact'); }), { type: 'value', scale: true });

    var points = [];
    if (groupDim) {
      var map = groupRows(rows, groupDim);
      Array.from(map.keys()).forEach(function (k) {
        points.push({
          name: k,
          value: [aggregate(map.get(k), w.x.metric), aggregate(map.get(k), w.y.metric)],
        });
      });
    } else {
      points = rows.map(function (r) { return { name: '', value: [num(r[w.x.field]), num(r[w.y.field])] }; });
    }

    base.tooltip.formatter = function (p) {
      return (p.data.name ? '<b>' + escapeHtml(p.data.name) + '</b><br>' : '') +
        (w.x.label || metricLabel(w.x.metric)) + ': ' + formatMetric(p.data.value[0], w.x.metric) + '<br>' +
        (w.y.label || metricLabel(w.y.metric)) + ': ' + formatMetric(p.data.value[1], w.y.metric);
    };
    base.series = [{
      type: 'scatter',
      symbolSize: 12,
      itemStyle: { borderColor: css('--yd-surface'), borderWidth: 2 },
      data: points,
      label: w.show_labels ? { show: true, position: 'top', fontSize: 11, color: css('--yd-ink-2'), formatter: function (p) { return p.data.name; } } : undefined,
    }];
    return base;
  }

  function resizeCharts() {
    state.charts.forEach(function (c) { if (c.instance) c.instance.resize(); });
  }

  /* ----------------------------------------------------------------- data */

  function fetchSource(name, src) {
    if (src.rows) { state.data[name] = src.rows; return Promise.resolve(); }
    var url = src.url || src.file;
    if (!url) { state.data[name] = []; return Promise.resolve(); }
    return fetch(url, { headers: src.headers || undefined, credentials: src.credentials || 'same-origin' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return src.format === 'csv' || /\.csv(\?|$)/.test(url) ? r.text().then(parseCsvClient) : r.json();
      })
      .then(function (payload) {
        var rows = payload;
        if (src.root) src.root.split('.').forEach(function (p) { rows = rows ? rows[p] : null; });
        state.data[name] = Array.isArray(rows) ? rows : [];
      })
      .catch(function (err) {
        state.errors[name] = err.message;
        state.data[name] = [];
      });
  }

  function parseCsvClient(text) {
    var lines = text.replace(/\r\n/g, '\n').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (!lines.length) return [];
    var header = splitCsvLine(lines[0]);
    return lines.slice(1).map(function (line) {
      var cells = splitCsvLine(line);
      var row = {};
      header.forEach(function (h, i) {
        var v = cells[i];
        row[h] = v !== undefined && v !== '' && !isNaN(Number(v)) ? Number(v) : (v === '' ? null : v);
      });
      return row;
    });
  }

  function splitCsvLine(line) {
    var out = [];
    var cur = '';
    var q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(function (s) { return s.trim(); });
  }

  /* ------------------------------------------------------------------ init */

  function start() {
    var sources = Object.entries(spec.data || {});
    Promise.all(sources.map(function (entry) { return fetchSource(entry[0], entry[1]); })).then(function () {
      state.filters = readUrl();
      boot();
      state.booted = true;
      sources.forEach(function (entry) {
        var src = entry[1];
        if (src.refresh) {
          setInterval(function () { fetchSource(entry[0], src).then(renderAll); }, src.refresh * 1000);
        }
      });
    });
  }

  window.addEventListener('resize', debounce(resizeCharts, 120));
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', function () { if (state.booted) renderAll(); });
  }

  // Small embed API so a host page (WordPress block, Wix iframe, SPA) can drive
  // the dashboard without rebuilding it.
  window.yadash = {
    spec: spec,
    setFilter: function (id, value) { state.filters[id] = value; onFilterChange(); },
    getFilters: function () { return JSON.parse(JSON.stringify(state.filters)); },
    setTheme: function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      if (state.booted) renderAll();
    },
    refresh: function () {
      return Promise.all(Object.entries(spec.data || {}).map(function (e) { return fetchSource(e[0], e[1]); })).then(renderAll);
    },
  };
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object' || String(msg.type || '').indexOf('yadash:') !== 0) return;
    if (msg.type === 'yadash:setFilter') window.yadash.setFilter(msg.id, msg.value);
    if (msg.type === 'yadash:setTheme') window.yadash.setTheme(msg.theme);
    if (msg.type === 'yadash:refresh') window.yadash.refresh();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
