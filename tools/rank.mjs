// 毎月1日に GitHub Actions から動く。その月のお題（駅・市区町村・城…）を全国から集めて前歴を判定し、
// rankings/<お題>.json と rankings/index.json、X投稿用の文章 rankings/<お題>.post.txt を作る。
// 判定ルールは index.html の中のもの（LF / SWALE / DEPTH / judge）をそのまま読み込んで使う。
import fs from "node:fs";
import vm from "node:vm";
import { PNG } from "pngjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SITE = "https://arai-sarai-data.github.io/zenreki/";
const GSI = "https://cyberjapandata.gsi.go.jp/xyz/";
const HZ = "https://disaportaldata.gsi.go.jp/raster/";
const UA = "zenreki-ranking/1.0 (+https://arai-sarai-data.github.io/zenreki/)";

// お題。auto のときは月ごとに順番に回す
const THEMES = [
  { key: "station", title: "駅", lead: "全国の有名な駅", cls: ["Q55488"], limit: 2500 },
  { key: "municipality", title: "市区町村の役所", lead: "全国の市区町村（役所の場所）", cls: ["Q494721", "Q5327704", "Q1059478", "Q4174776"], limit: 2000 },
  { key: "mall", title: "ショッピングモール", lead: "全国のショッピングモール", cls: ["Q11315", "Q31374404"], limit: 1500 },
  { key: "univ", title: "大学", lead: "全国の大学", cls: ["Q3918"], limit: 800 },
  { key: "castle", title: "城", lead: "全国の城", cls: ["Q92026", "Q23413"], limit: 1300 },
  { key: "stadium", title: "スタジアム・球場", lead: "全国のスタジアム・球場", cls: ["Q483110", "Q595452", "Q1154710"], limit: 600 },
  { key: "leisure", title: "空港・テーマパーク・動物園", lead: "全国の空港・テーマパーク・動物園", cls: ["Q1248784", "Q644371", "Q2416723", "Q194195", "Q43501"], limit: 600 },
  { key: "shrine", title: "有名な神社", lead: "全国の有名な神社", cls: ["Q845945"], limit: 1500 },
  { key: "temple", title: "有名な寺", lead: "全国の有名な寺", cls: ["Q5393308"], limit: 1500 },
];
const WET = new Set(["水底", "干拓", "旧河道", "水面", "干潟", "田圃", "湿地", "塩田"]);
const SEA = new Set(["水底", "干拓", "旧河道", "干潟"]);

// ---- index.html から判定ルールを取り出す ----
const html = fs.readFileSync(ROOT + "index.html", "utf8");
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error("index.html の構造が変わっています: " + a); return html.slice(i, j); };
const ctx = {};
vm.createContext(ctx);
vm.runInContext(cut("const LF = [", "/* ---------- 小道具") + "\n" + cut("function judge(d){", "/* ---------- 調べる") +
  "\nthis.LFC=LFC;this.SWALE=SWALE;this.DEPTH=DEPTH;this.judge=judge;", ctx);
const { LFC, SWALE, DEPTH, judge } = ctx;

// ---- 通信 ----
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, kind = "buf", tries = 3) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      return kind === "json" ? await r.json() : kind === "text" ? await r.text() : Buffer.from(await r.arrayBuffer());
    } catch (e) { if (t === tries - 1) { console.warn("取得失敗", url, String(e)); return null } await sleep(1500 * (t + 1)); }
  }
}
const cache = new Map();
function memo(key, fn) { if (!cache.has(key)) cache.set(key, fn()); return cache.get(key); }

function tileXY(lat, lon, z) { const n = 2 ** z, r = lat * Math.PI / 180; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n]; }
function png(url) {
  return memo(url, async () => { const b = await get(url); if (!b || b.length < 200) return null; try { const p = PNG.sync.read(b); return { data: p.data, w: p.width }; } catch { return null; } });
}
function nearest(rgb, pal, tol = 28) { let best = null, bd = 1e9; for (const p of pal) { const c = p[0], d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2; if (d < bd) { bd = d; best = p; } } return bd <= tol * tol ? best : null; }
async function pixelVote(tpl, lat, lon, z, pal, r = 2) {
  const [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
  const t = await png(tpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty)); if (!t) return null;
  const cx = Math.floor((fx - tx) * 256), cy = Math.floor((fy - ty) * 256), votes = new Map(); let center = null;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x > 255 || y > 255) continue;
    const i = (y * t.w + x) * 4, d = t.data; if (d[i + 3] < 128) continue;
    const m = nearest([d[i], d[i + 1], d[i + 2]], pal); if (!m) continue;
    if (dx === 0 && dy === 0) center = m; votes.set(m, (votes.get(m) || 0) + 1);
  }
  if (center) return center; let best = null, bn = 0; votes.forEach((n, m) => { if (n > bn) { bn = n; best = m; } }); return best;
}
async function pixel(tpl, lat, lon, z) {
  const [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
  const t = await png(tpl.replace("{z}", z).replace("{x}", tx).replace("{y}", ty)); if (!t) return null;
  const px = Math.min(255, Math.floor((fx - tx) * 256)), py = Math.min(255, Math.floor((fy - ty) * 256)), i = (py * t.w + px) * 4, d = t.data;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}
function pip(pt, ring) { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) ins = !ins; } return ins; }
function inPoly(pt, g) { const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; return polys.some(p => pip(pt, p[0]) && !p.slice(1).some(h => pip(pt, h))); }
async function landform(n, lat, lon) {
  for (const z of [16, 14, 13]) {
    const [fx, fy] = tileXY(lat, lon, z), url = `${GSI}experimental_landformclassification${n}/${z}/${Math.floor(fx)}/${Math.floor(fy)}.geojson`;
    const g = await memo(url, () => get(url, "json")); if (!g || !g.features) continue;
    for (const f of g.features) { const c = +f.properties.code; if (LFC[c] && inPoly([lon, lat], f.geometry)) return { ...LFC[c], code: c }; }
  }
  return null;
}
async function elevation(lat, lon) {
  for (const [L, z] of [["dem5a_png", 15], ["dem5b_png", 15], ["dem_png", 14]]) {
    const p = await pixel(`${GSI}${L}/{z}/{x}/{y}.png`, lat, lon, z);
    if (!p || p[3] === 0 || (p[0] === 128 && p[1] === 0 && p[2] === 0)) continue;
    const x = p[0] * 65536 + p[1] * 256 + p[2]; return Math.round((x < 2 ** 23 ? x : x - 2 ** 24) * 0.01 * 10) / 10;
  }
  return null;
}
let MUNI = null;
async function pref(lat, lon) {
  if (!MUNI) { MUNI = {}; const t = await get("https://maps.gsi.go.jp/js/muni.js", "text") || ""; for (const m of t.matchAll(/\["(\d+)"\]\s*=\s*'([^']*)'/g)) { const a = m[2].split(","); MUNI[+m[1]] = [a[1], a[3].replace(/[　\s]/g, "")]; } }
  const j = await get(`https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lon}`, "json");
  const m = j && j.results && MUNI[+j.results.muniCd]; return m ? m : [null, null];
}

// ---- お題の場所を集める（Wikidata） ----
async function places(th) {
  const q = `SELECT ?i ?l ?co ?sl WHERE { VALUES ?c { ${th.cls.map(c => "wd:" + c).join(" ")} } ?i wdt:P31 ?c; wdt:P17 wd:Q17; wdt:P625 ?co; wikibase:sitelinks ?sl. ?i rdfs:label ?l. FILTER(LANG(?l)="ja") } ORDER BY DESC(?sl) LIMIT ${th.limit * 2}`;
  const j = await get("https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(q), "json", 4);
  if (!j) throw new Error("Wikidata から取得できませんでした");
  const seen = new Set(), out = [];
  for (const b of j.results.bindings) {
    const id = b.i.value.split("/").pop(); if (seen.has(id)) continue; seen.add(id);
    const m = b.co.value.match(/Point\(([-\d.]+) ([-\d.]+)\)/); if (!m) continue;
    const lo = +m[1], la = +m[2]; if (la < 20 || la > 46 || lo < 122 || lo > 154) continue;
    out.push({ q: id, n: b.l.value, la: +la.toFixed(6), lo: +lo.toFixed(6), sl: +b.sl.value });
    if (out.length >= th.limit) break;
  }
  return out;
}

async function pool(items, n, fn) { let i = 0, done = 0; const res = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); if (++done % 100 === 0) console.log(`  ${done}/${items.length}`); } }));
  return res; }

async function runTheme(th) {
  console.log(`■ ${th.title}：場所を集めています`);
  const list = await places(th);
  console.log(`  ${list.length} か所。判定します`);
  const items = await pool(list, 6, async p => {
    const [elev, swale, lf1, lf2, flood, pr] = await Promise.all([
      elevation(p.la, p.lo), pixelVote(`${GSI}swale/{z}/{x}/{y}.png`, p.la, p.lo, 14, SWALE),
      landform(1, p.la, p.lo), landform(2, p.la, p.lo),
      pixelVote(`${HZ}01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png`, p.la, p.lo, 16, DEPTH, 1), pref(p.la, p.lo)]);
    const v = judge({ swale, lf1, lf2 });
    return { ...p, p: pr[0], c: pr[1], s: v.stamp, w: v.word, e: elev, m: swale ? swale[1] : null, l1: lf1 ? lf1.n : null, l2: lf2 ? lf2.n : null,
      f: flood ? flood[2] : -1, fl: flood ? flood[1] : null };
  });
  const known = items.filter(x => x.s !== "不詳");
  const wet = known.filter(x => WET.has(x.s)), sea = known.filter(x => SEA.has(x.s));
  const byPref = {};
  for (const x of known) { if (!x.p) continue; const b = byPref[x.p] ||= { n: 0, wet: 0 }; b.n++; if (WET.has(x.s)) b.wet++; }
  const stats = { total: items.length, known: known.length, wet: wet.length, sea: sea.length,
    wetPct: known.length ? Math.round(wet.length / known.length * 100) : 0,
    seaPct: known.length ? Math.round(sea.length / known.length * 100) : 0,
    below0: items.filter(x => x.e != null && x.e <= 0).length, flood3: items.filter(x => x.f >= 2).length, byPref };
  const updated = new Date().toISOString().slice(0, 10);
  const data = { key: th.key, title: th.title, lead: th.lead, updated, stats, items };
  fs.mkdirSync(ROOT + "rankings", { recursive: true });
  fs.writeFileSync(`${ROOT}rankings/${th.key}.json`, JSON.stringify(data));
  fs.writeFileSync(`${ROOT}rankings/${th.key}.post.txt`, postText(data));
  console.log(`  完了：前歴がわかった ${known.length} か所のうち ${stats.wetPct}% が水・田・湿地`);
  return data;
}

function postText(d) {
  const s = d.stats, sea = d.items.filter(x => SEA.has(x.s)).slice(0, 3).map(x => x.n);
  const low = d.items.filter(x => x.e != null).sort((a, b) => a.e - b.e)[0];
  const lines = [`【土地の前歴】${d.lead}${s.known}か所を調べたら、${s.wetPct}%が明治のころ「水・田んぼ・湿地」でした。`];
  if (sea.length) lines.push(`元・水の底：${sea.join("、")}`);
  if (low) lines.push(`海抜がいちばん低い：${low.n}（${low.e.toFixed(1)}m）`);
  lines.push(`${SITE}#rank-${d.key}`, "#土地の前歴");
  return lines.join("\n") + "\n";
}

// ---- 実行 ----
const arg = (process.argv[2] || "auto").trim();
let targets;
if (arg === "auto") { const d = new Date(); targets = [THEMES[(d.getUTCFullYear() * 12 + d.getUTCMonth()) % THEMES.length]]; }
else if (arg === "all") targets = THEMES;
else targets = arg.split(",").map(k => THEMES.find(t => t.key === k.trim())).filter(Boolean);
if (!targets.length) { console.error("お題が見つかりません: " + arg); process.exit(1); }

const idxPath = ROOT + "rankings/index.json";
let index = { latest: null, themes: {} };
try { index = JSON.parse(fs.readFileSync(idxPath, "utf8")); } catch { }
for (const th of targets) {
  try {
    const d = await runTheme(th);
    index.themes[th.key] = { title: th.title, lead: th.lead, updated: d.updated, total: d.stats.known, wetPct: d.stats.wetPct, seaPct: d.stats.seaPct };
    if (arg === "auto" || !index.latest) index.latest = th.key;
  } catch (e) { console.error(`× ${th.title} は失敗しました：`, e); process.exitCode = 1; }
}
if (arg === "all") index.latest = THEMES[0].key;
index.order = THEMES.map(t => t.key).filter(k => index.themes[k]);
index.next = THEMES[(new Date().getUTCFullYear() * 12 + new Date().getUTCMonth() + 1) % THEMES.length].title;
fs.mkdirSync(ROOT + "rankings", { recursive: true });
fs.writeFileSync(idxPath, JSON.stringify(index, null, 1));
console.log("index.json を更新しました");
