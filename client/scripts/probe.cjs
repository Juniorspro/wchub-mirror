const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const vc = new VirtualConsole();
let first = null;
vc.on('jsdomError', (e) => {
  if (!first) first = e;
  console.log('JSDOM ERROR:', e.message);
  const st = (e.detail && e.detail.stack) || e.stack || '';
  console.log(String(st).split('\n').slice(0, 7).join('\n'));
});
vc.on('error', (...a) => console.log('console.error:', String(a[0]).slice(0, 200)));
vc.on('log', (...a) => console.log('console.log:', String(a[0]).slice(0, 120)));
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'file:///game.html',
  beforeParse(w) {
    w.matchMedia = (q) => ({ matches: false, media: q, addEventListener(){}, removeEventListener(){}, addListener(){}, removeListener(){}, dispatchEvent(){ return false } });
    w.AudioContext = function(){ return { state:'running', resume(){}, createGain(){ return { gain:{value:0}, connect(){} } }, createOscillator(){ return { type:'', frequency:{value:0}, connect(){}, start(){}, stop(){} } }, createBuffer(){ return { getChannelData(){ return new Float32Array(1) } } }, createBufferSource(){ return { connect(){}, start(){}, stop(){} } }, createBiquadFilter(){ return { type:'', frequency:{value:0}, Q:{value:0}, connect(){} } }, destination:{}, currentTime:0, sampleRate:48000 }; };
    w.webkitAudioContext = w.AudioContext;
  },
});
setTimeout(() => { console.log(first ? 'CAPTURADO' : 'sin errores en 5s'); process.exit(0); }, 5000);
