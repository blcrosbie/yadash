// Regenerates the synthetic datasets under examples/data/ for the
// non-sales/support example dashboards (ecommerce.yaml, marketing.yaml).
// Zero dependencies, on purpose - a seeded PRNG instead of a `faker`
// package, so the output is deterministic and reviewable in a diff.
//
//   node scripts/generate-example-data.mjs
//
// Not shipped in the npm package (not in package.json's "files").
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'examples', 'data');

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260923);
const pick = (arr, weights) => {
  if (!weights) return arr[Math.floor(rand() * arr.length)];
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
  return arr[arr.length - 1];
};
const int = (min, max) => Math.floor(min + rand() * (max - min + 1));
const dateStr = (d) => d.toISOString().slice(0, 10);
const csvCell = (v) => (typeof v === 'string' && /[,"\n]/.test(v)) ? `"${v.replace(/"/g, '""')}"` : v;
const toCsv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';

// ---------- E-commerce orders (examples/ecommerce.yaml) ----------
const categories = {
  Apparel: [['Classic Tee', 22], ['Denim Jacket', 78], ['Wool Scarf', 34]],
  Electronics: [['Wireless Earbuds', 89], ['Smart Speaker', 64], ['USB-C Hub', 41]],
  Home: [['Ceramic Mug Set', 28], ['Throw Blanket', 46], ['Desk Lamp', 39]],
  Beauty: [['Vitamin C Serum', 32], ['Matte Lipstick', 19], ['Body Lotion', 24]],
  Outdoor: [['Trail Backpack', 96], ['Insulated Bottle', 27], ['Camp Chair', 58]],
};
const catNames = Object.keys(categories);
const channels = ['organic', 'paid_search', 'paid_social', 'email', 'direct'];
const channelWeights = [30, 26, 18, 14, 12];

const orders = [];
const orderStart = new Date('2026-06-15T00:00:00Z');
for (let day = 0; day < 75; day++) {
  const d = new Date(orderStart.getTime() + day * 86400000);
  const isWeekend = [0, 6].includes(d.getUTCDay());
  const n = int(isWeekend ? 4 : 2, isWeekend ? 9 : 7);
  for (let i = 0; i < n; i++) {
    const category = pick(catNames);
    const [product, unitPrice] = pick(categories[category]);
    const units = pick([1, 1, 1, 2, 2, 3], [30, 30, 30, 20, 15, 5]);
    const noise = 1 + (rand() - 0.5) * 0.2;
    const revenue = Math.round(unitPrice * units * noise * 100) / 100;
    orders.push({
      order_date: dateStr(d),
      channel: pick(channels, channelWeights),
      category,
      product,
      units,
      revenue,
      new_customer: rand() < 0.36 ? 1 : 0,
    });
  }
}
writeFileSync(join(OUT, 'orders.csv'), toCsv(orders, ['order_date', 'channel', 'category', 'product', 'units', 'revenue', 'new_customer']));
console.log('examples/data/orders.csv', orders.length, 'rows');

// ---------- Marketing campaigns (examples/marketing.yaml) ----------
const campaignsByChannel = {
  google_search: ['Brand - Search', 'Category - Search'],
  meta: ['Prospecting - Feed', 'Retargeting - Stories'],
  tiktok: ['Spark Ads - Launch'],
  email: ['Newsletter - Weekly'],
  affiliate: ['Partner - Bloggers'],
};
const channelProfile = {
  google_search: { spend: [60, 260], cpmCents: [800, 1600], ctr: [0.03, 0.06], cvr: [0.05, 0.09], aov: [70, 110] },
  meta: { spend: [50, 220], cpmCents: [600, 1300], ctr: [0.008, 0.02], cvr: [0.02, 0.05], aov: [55, 95] },
  tiktok: { spend: [30, 140], cpmCents: [500, 1000], ctr: [0.01, 0.025], cvr: [0.015, 0.035], aov: [40, 70] },
  email: { spend: [15, 35], cpmCents: [200, 400], ctr: [0.02, 0.04], cvr: [0.03, 0.06], aov: [65, 100] },
  affiliate: { spend: [20, 90], cpmCents: [400, 900], ctr: [0.015, 0.03], cvr: [0.03, 0.06], aov: [60, 90] },
};
const frange = (r) => r[0] + rand() * (r[1] - r[0]);

const campaigns = [];
const campStart = new Date('2026-07-01T00:00:00Z');
for (let day = 0; day < 60; day++) {
  const d = new Date(campStart.getTime() + day * 86400000);
  for (const [channel, names] of Object.entries(campaignsByChannel)) {
    for (const campaign of names) {
      if (rand() < 0.08) continue; // occasional pause day
      const p = channelProfile[channel];
      const spend = Math.round(frange(p.spend) * 100) / 100;
      const impressions = Math.round(spend / (frange(p.cpmCents) / 100000));
      const clicks = Math.max(1, Math.round(impressions * frange(p.ctr)));
      const conversions = Math.max(0, Math.round(clicks * frange(p.cvr)));
      const revenue = Math.round(conversions * frange(p.aov) * 100) / 100;
      campaigns.push({ date: dateStr(d), channel, campaign, spend, impressions, clicks, conversions, revenue });
    }
  }
}
writeFileSync(join(OUT, 'campaigns.csv'), toCsv(campaigns, ['date', 'channel', 'campaign', 'spend', 'impressions', 'clicks', 'conversions', 'revenue']));
console.log('examples/data/campaigns.csv', campaigns.length, 'rows');
