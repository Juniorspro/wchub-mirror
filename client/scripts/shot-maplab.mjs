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
// vista más lejana (zoom out con rueda)
await page.mouse.move(540, 1100);
await page.mouse.wheel(0, 1200);
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/patio-v2-wide.png' });
// vista del portal de entrada desde afuera (sur), a altura de jugador
await page.evaluate(() => {
  const cam = window.__maplab?.camera;
  if (cam) { cam.alpha = Math.PI / 2; cam.beta = 1.38; cam.radius = 34; cam.target.y = 2; }
});
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/patio-v2-gate.png' });
await browser.close();
console.log('screenshots ok');
