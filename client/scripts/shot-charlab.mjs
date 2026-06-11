// Capturas del charlab en Chromium headless (SwiftShader).
// Uso: node scripts/shot-charlab.mjs → /tmp/personaje-*.png
import { chromium } from 'playwright';
import path from 'node:path';

const file = 'file://' + path.resolve('dist-charlab/index.html');
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1080, height: 2200 }, deviceScaleFactor: 1 });
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(4500);
const errText = await page.locator('#err').textContent();
if (errText && errText.trim()) console.log('[#err]', errText.trim());

const views = [
  ['front', { alpha: -Math.PI / 2, beta: 1.32, radius: 3.4 }],
  ['side',  { alpha: -Math.PI / 6, beta: 1.25, radius: 3.8 }],
  ['back',  { alpha: Math.PI / 2, beta: 1.3, radius: 3.6 }],
];
for (const [name, v] of views) {
  await page.evaluate((v) => {
    const cam = window.__charlab?.camera;
    if (cam) { cam.alpha = v.alpha; cam.beta = v.beta; cam.radius = v.radius; }
  }, v);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/personaje-${name}.png` });
}
// saludo a mitad de animación
await page.evaluate(() => {
  const cl = window.__charlab;
  if (cl) { cl.camera.alpha = -Math.PI / 2; cl.camera.beta = 1.3; cl.camera.radius = 3.6; cl.wave(); }
});
await page.waitForTimeout(800);
await page.screenshot({ path: '/tmp/personaje-wave.png' });
await browser.close();
console.log('screenshots ok');
