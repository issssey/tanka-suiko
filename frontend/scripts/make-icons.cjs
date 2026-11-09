// アプリのアイコン（PWA・iPhone のホーム画面・favicon）を作る。
// 形はデザイン「アプリアイコン案」の案C2：右から五・七・五・七・七の長さで5本の縦線（紺）を和紙色の地に引く。
// 使い方：node scripts/make-icons.cjs（Chromium で SVG を PNG に描き、public/icons に書き出す）
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const NAVY = "#27467A";
const PAPER = "#FAFAF7";
const LINE = "#E4E1DA";
const OUT = path.join(__dirname, "..", "public", "icons");

/** 5本の線。scale で中心に寄せる（maskable は丸く切り抜かれても欠けないよう内側に寄せる）。 */
function lines(scale = 1) {
  const xs = [78, 64, 50, 36, 22]; // 右から
  const morae = [5, 7, 5, 7, 7];
  const top = 20;
  const unit = 60 / 7; // 7音の線が y=20〜80
  const t = (v) => (50 + (v - 50) * scale).toFixed(2);
  return xs
    .map((x, i) => `<line x1="${t(x)}" y1="${t(top)}" x2="${t(x)}" y2="${t(top + morae[i] * unit)}" stroke="${NAVY}" stroke-width="${(4.5 * scale).toFixed(2)}" stroke-linecap="round"/>`)
    .join("");
}

/** rounded：角を丸めて枠線を付ける（favicon・一般のアイコン）。false なら全面を地の色で塗る（iPhone・maskable は端末が切り抜く）。 */
function svg({ rounded, scale = 1 }) {
  const bg = rounded
    ? `<rect x="0.5" y="0.5" width="99" height="99" rx="22.5" fill="${PAPER}" stroke="${LINE}" stroke-width="1"/>`
    : `<rect width="100" height="100" fill="${PAPER}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${bg}${lines(scale)}</svg>`;
}

const ICONS = [
  { file: "icon-192.png", size: 192, rounded: true },
  { file: "icon-512.png", size: 512, rounded: true },
  { file: "icon-maskable-512.png", size: 512, rounded: false, scale: 0.72 },
  { file: "apple-touch-icon.png", size: 180, rounded: false },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "icon.svg"), svg({ rounded: true }) + "\n");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const icon of ICONS) {
    await page.setViewportSize({ width: icon.size, height: icon.size });
    const body = svg(icon).replace("<svg ", `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
    await page.screenshot({ path: path.join(OUT, icon.file), omitBackground: true, clip: { x: 0, y: 0, width: icon.size, height: icon.size } });
    console.log("wrote", icon.file);
  }
  await browser.close();
})();
