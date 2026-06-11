// Captura del maplab en Chromium headless (SwiftShader = WebGL por software).
// Uso: node scripts/shot-maplab.mjs   (requiere: npm i --no-save playwright
//      && npx playwright install chromium). Screenshots → /tmp/patio-v2-*.png
import { chromium } from 'playwright';
import path from 'node:path';

const file = 'file://' + path.resolve('dist-maplab/index.html');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 2200 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(6000);
const errText = await page.locator('#err').textContent();
if (errText && errText.trim()) console.log('[#err]', errText.trim());
await page.screenshot({ path: '/tmp/patio-v2-mobile.png' });
// vistas fijas: aérea total, portal, tienda con ícono neón, sectores
const views = [
  ['wide',    { alpha: -Math.PI / 2, beta: 0.85, radius: 95, tx: 0, ty: 0, tz: 28 }],
  ['gate',    { alpha: Math.PI / 2, beta: 1.38, radius: 34, tx: 0, ty: 2, tz: 0 }],
  ['tienda',  { alpha: -Math.PI / 2, beta: 1.25, radius: 12, tx: 0, ty: 3, tz: 17.5 }],
  ['cancha',  { alpha: Math.PI, beta: 1.05, radius: 30, tx: 44, ty: 1, tz: -5 }],
  ['copas',   { alpha: -Math.PI / 2, beta: 1.15, radius: 17, tx: 20.5, ty: 2.5, tz: 32 }],
  ['muneco',  { alpha: -Math.PI / 2, beta: 1.25, radius: 13, tx: -31.7, ty: 2.5, tz: -4.3 }],
  ['estadio', { alpha: -Math.PI / 2 + 0.35, beta: 1.18, radius: 62, tx: 0, ty: 7, tz: 48 }],
];
for (const [name, v] of views) {
  await page.evaluate((v) => {
    const cam = window.__maplab?.camera;
    if (cam) { cam.alpha = v.alpha; cam.beta = v.beta; cam.radius = v.radius; cam.target.set(v.tx, v.ty, v.tz); }
  }, v);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `/tmp/patio-v2-${name}.png` });
}
await browser.close();
console.log('screenshots ok');
