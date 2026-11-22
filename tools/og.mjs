// 公開の直前に GitHub Actions で動く。ランキングに載る場所ごとに、
// Xなどでリンクを貼ったときに出るプレビュー画像（p/<ID>.png）と、その画像を指す小さなページ（p/<ID>.html）を作る。
import fs from "node:fs";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = process.argv[2] || ROOT + "_site/";
const SITE = "https://arai-sarai-data.github.io/zenreki/";
const GSI = "https://cyberjapandata.gsi.go.jp/xyz/";
const UA = "zenreki-og/1.0 (+https://arai-sarai-data.github.io/zenreki/)";
const PER_LIST = 15;

for (const [p, n] of [["/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc", "SerifJP"], ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "SansJP"], ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "SansJPR"]]) {
  if (fs.existsSync(p)) GlobalFonts.registerFromPath(p, n); else console.warn("フォントがありません", p);
}
const M = "SerifJP", G = "SansJP", GR = "SansJPR", INK = "#1b1a17", SHU = "#c4321a", PAPER = "#f2eee3";
const SEA = new Set(["水底", "干拓", "旧河道", "水面", "干潟"]), WET = new Set([...SEA, "田圃", "湿地", "塩田"]);
const WATERK = /[沼池窪谷島洲浜田川沢潟江津湊浦堀瀬]/;
const DEPTH_NOTE = ["床下くらい", "1階の床上〜軒下", "2階の床まで", "2階の屋根まで", "3〜5階まで", "ビル6階以上"];

// ---- どの場所の画像を作るか（サイトの一覧に出る上位） ----
function pick(it) {
  const fame = (a, b) => b.sl - a.sl, top = a => a.slice(0, PER_LIST);
  return [
    top(it.filter(x => SEA.has(x.s)).sort(fame)),
    top(it.filter(x => WET.has(x.s) && !SEA.has(x.s)).sort(fame)),
    top(it.filter(x => x.e != null).sort((a, b) => a.e - b.e)),
    top(it.filter(x => x.f >= 0).sort((a, b) => b.f - a.f || (a.e ?? 99) - (b.e ?? 99))),
    top(it.filter(x => x.s === "台地").sort(fame)),
    top(it.filter(x => WATERK.test(x.n) && ["台地", "斜面", "切土", "扇状地", "微高地"].includes(x.s)).sort(fame)),
    top(it.filter(x => !WATERK.test(x.n) && SEA.has(x.s)).sort(fame)),
    it.slice().sort(fame).slice(0, 40),
  ].flat();
}

// ---- 昔の空中写真を切り出す ----
const tileCache = new Map();
async function tile(url) {
  if (tileCache.has(url)) return tileCache.get(url);
  const p = (async () => {
    for (let t = 0; t < 3; t++) {
      try {
        const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
        if (r.status === 404) return null; if (!r.ok) throw new Error(r.status);
        const b = Buffer.from(await r.arrayBuffer()); if (b.length < 200) return null; return await loadImage(b);
      } catch { await new Promise(r => setTimeout(r, 1000 * (t + 1))); }
    }
    return null;
  })();
  tileCache.set(url, p); return p;
}
function tileXY(lat, lon, z) { const n = 2 ** z, r = lat * Math.PI / 180; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n]; }
async function oldPhoto(lat, lon, W, H) {
  if (process.env.OG_OFFLINE) return null;
  for (const [L, cap, ext] of [["ort_USA10", "昭和20年代 米軍撮影", "png"], ["ort_old10", "昭和30〜40年代撮影", "png"], ["gazo1", "昭和50年代撮影", "jpg"]]) {
    const z = 16, [fx, fy] = tileXY(lat, lon, z), tx = Math.floor(fx), ty = Math.floor(fy);
    const c = createCanvas(W, H), x = c.getContext("2d"), cx = (fx - tx) * 256, cy = (fy - ty) * 256; let got = 0;
    await Promise.all([-1, 0, 1].flatMap(dy => [-1, 0, 1].map(async dx => {
      const im = await tile(`${GSI}${L}/${z}/${tx + dx}/${ty + dy}.${ext}`); if (!im) return; got++;
      x.drawImage(im, W / 2 - cx + dx * 256, H / 2 - cy + dy * 256);
    })));
    if (got < 7) continue;
    const d = x.getImageData(0, 0, W, H).data; let bad = 0;
    for (let i = 0; i < d.length; i += 400) if (d[i + 3] === 0 || d[i] + d[i + 1] + d[i + 2] < 30) bad++;
    if (bad > d.length / 400 * 0.1) continue;
    return { c, cap };
  }
  return null;
}

function wrap(x, text, maxW) { const NOHEAD = "）」』。、・ー"; const out = []; let line = ""; for (const ch of text) { if (x.measureText(line + ch).width > maxW && line && !NOHEAD.includes(ch)) { out.push(line); line = ch; } else line += ch; } if (line) out.push(line); return out; }

async function card(it) {
  const W = 1200, H = 630, c = createCanvas(W, H), x = c.getContext("2d");
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.strokeStyle = INK; x.lineWidth = 3; x.strokeRect(24, 24, W - 48, H - 48); x.lineWidth = 1; x.strokeRect(32, 32, W - 64, H - 64);
  const px = W - 64 - 330, py = 84, pw = 300, ph = 375;
  const ph1 = await oldPhoto(it.la, it.lo, 300, 375);
  if (ph1) { x.drawImage(ph1.c, px, py, pw, ph); } else { x.fillStyle = "#ddd8ca"; x.fillRect(px, py, pw, ph); x.fillStyle = "#5d5a52"; x.font = `22px ${GR}`; x.textAlign = "center"; x.fillText("古い写真なし", px + pw / 2, py + ph / 2); x.textAlign = "left"; }
  if (ph1) { x.strokeStyle = "rgba(196,50,26,.9)"; x.lineWidth = 3; x.beginPath(); x.arc(px + pw / 2, py + ph / 2, 14, 0, 7); x.stroke(); }
  x.strokeStyle = INK; x.lineWidth = 2; x.strokeRect(px, py, pw, ph);
  x.fillStyle = "#5d5a52"; x.font = `16px ${GR}`; if (ph1) x.fillText(ph1.cap + "（国土地理院）", px, py + ph + 26);
  x.fillStyle = INK; x.font = `30px ${M}`; x.fillText("前　歴　書", 70, 96);
  x.font = `38px ${M}`; const nm = wrap(x, it.n, px - 110).slice(0, 2); nm.forEach((l, i) => x.fillText(l, 70, 156 + i * 46));
  x.fillStyle = "#5d5a52"; x.font = `20px ${GR}`; const yPref = 156 + (nm.length - 1) * 46 + 34; x.fillText((it.p || "") + (it.c || ""), 72, yPref);
  const calm = ["台地", "扇状地", "微高地"].includes(it.s), word = it.w || "記録なし";
  let top = yPref + 50; x.fillStyle = INK; x.font = `40px ${M}`; x.fillText(calm ? "ここは昔から" : "ここは昔、", 70, top);
  x.fillStyle = SHU; let fs = 76, lines;
  for (fs of [76, 66, 58, 50, 44]) { x.font = `${fs}px ${M}`; lines = wrap(x, word + "。", px - 120); if (lines.length <= 2 && lines.every(l => x.measureText(l).width <= px - 90)) break; }
  lines = lines.slice(0, 2); lines.forEach((l, i) => x.fillText(l, 70, top + fs + 14 + i * (fs + 10)));
  let y = Math.min(top + fs + 14 + lines.length * (fs + 10) + 6, H - 104);
  x.fillStyle = INK; x.font = `22px ${G}`;
  const facts = []; if (it.e != null) facts.push(`海抜 ${it.e.toFixed(1)}m`); if (it.m) facts.push(`明治：${it.m}`); if (it.f >= 0) facts.push(`洪水想定 ${it.fl}`);
  wrap(x, facts.join("　／　"), px - 110).slice(0, 1).forEach(l => x.fillText(l, 70, y));
  // 判子
  const sx = px + pw - 46, sy = py + ph - 70, r = 70, col = calm ? "#2c4f83" : SHU;
  x.save(); x.translate(sx, sy); x.rotate(-0.21); x.globalAlpha = .9; x.strokeStyle = col; x.fillStyle = col;
  x.lineWidth = 5; x.beginPath(); x.arc(0, 0, r, 0, 7); x.stroke(); x.lineWidth = 2; x.beginPath(); x.arc(0, 0, r - 9, 0, 7); x.stroke();
  x.textAlign = "center"; x.font = `16px ${M}`; x.fillText("前 歴", 0, -26); x.fillRect(-30, -20, 60, 2);
  x.font = `${(it.s || "").length >= 3 ? 30 : 40}px ${M}`; x.fillText(it.s || "", 0, 26); x.restore();
  x.fillStyle = INK; x.fillRect(32, H - 82, W - 64, 50); x.fillStyle = PAPER; x.font = `22px ${G}`;
  x.fillText("土地の前歴 ― 住所を入れると、その土地の昔が出ます", 56, H - 49);
  x.textAlign = "right"; x.font = `20px ${G}`; x.fillText("@arai_sarai_data", W - 56, H - 49);
  return c.toBuffer("image/png");
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function page(it) {
  const title = `${it.n}の前歴は「${it.w || "記録なし"}」`;
  const desc = [it.p && it.p + (it.c || ""), it.e != null && `海抜${it.e.toFixed(1)}m`, it.m && `明治の地図では${it.m}`, it.f >= 0 && `洪水想定${it.fl}（${DEPTH_NOTE[it.f]}）`].filter(Boolean).join("。") + "。";
  const go = `../?ll=${it.la},${it.lo}&n=${encodeURIComponent(it.n)}`;
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | 土地の前歴</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="article"><meta property="og:url" content="${SITE}p/${it.q}.html">
<meta property="og:image" content="${SITE}p/${it.q}.png"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@arai_sarai_data">
<meta http-equiv="refresh" content="0;url=${esc(go)}"><link rel="canonical" href="${SITE}p/${it.q}.html">
</head><body style="font-family:sans-serif;background:#f2eee3;padding:24px"><p><a href="${esc(go)}">${esc(title)}。前歴書を開く</a></p></body></html>
`;
}

// ---- 実行 ----
let index; try { index = JSON.parse(fs.readFileSync(ROOT + "rankings/index.json", "utf8")); } catch { console.log("ランキングがまだありません"); process.exit(0); }
const all = new Map();
for (const k of index.order || []) {
  let d; try { d = JSON.parse(fs.readFileSync(`${ROOT}rankings/${k}.json`, "utf8")); } catch { continue; }
  for (const it of pick(d.items)) if (it.q && !all.has(it.q)) all.set(it.q, it);
}
fs.mkdirSync(OUT + "p", { recursive: true });
const list = [...all.values()].slice(0, +(process.env.OG_LIMIT || 1e9));
console.log(`${list.length} か所のプレビュー画像を作ります`);
let i = 0, done = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < list.length) {
    const it = list[i++];
    try { fs.writeFileSync(`${OUT}p/${it.q}.png`, await card(it)); fs.writeFileSync(`${OUT}p/${it.q}.html`, page(it)); }
    catch (e) { console.warn("失敗", it.n, String(e)); }
    if (++done % 50 === 0) console.log(`  ${done}/${list.length}`);
  }
}));
fs.writeFileSync(OUT + "p/list.json", JSON.stringify(list.filter(it => fs.existsSync(`${OUT}p/${it.q}.png`)).map(it => it.q)));
console.log("完了");
