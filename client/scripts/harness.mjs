// Ejecuta el bundle como MODULO ES real (lo que jsdom no puede) con DOM de jsdom.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true, url: 'http://localhost/'
});
const w = dom.window;
for (const k of ['window','document','navigator','location','HTMLElement','HTMLCanvasElement','Element','Node','CustomEvent','Event','getComputedStyle','requestAnimationFrame','cancelAnimationFrame','performance','localStorage','sessionStorage','screen','history','MutationObserver','DocumentFragment','SVGElement','Image','Audio','FileReader','Blob','URL','self']) {
  try { if (w[k] !== undefined && globalThis[k] === undefined) globalThis[k] = w[k]; } catch {}
}
globalThis.window.matchMedia = globalThis.matchMedia = (q)=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},dispatchEvent(){return false}});
class FakeAC { constructor(){this.state='running';this.destination={};this.currentTime=0;this.sampleRate=48000} resume(){return Promise.resolve()} createGain(){return{gain:{value:0},connect(){}}} createOscillator(){return{type:'',frequency:{value:0},connect(){},start(){},stop(){}}} createBuffer(){return{getChannelData(){return new Float32Array(1)}}} createBufferSource(){return{connect(){},start(){},stop(){},buffer:null,loop:false}} createBiquadFilter(){return{type:'',frequency:{value:0},Q:{value:0},connect(){}}} }
globalThis.window.AudioContext = globalThis.AudioContext = FakeAC;
globalThis.window.webkitAudioContext = FakeAC;
globalThis.window.WebGL2RenderingContext = globalThis.WebGL2RenderingContext = function(){};
globalThis.window.ResizeObserver = globalThis.ResizeObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.window.IntersectionObserver = globalThis.IntersectionObserver = class { observe(){} unobserve(){} disconnect(){} };
globalThis.fetch = globalThis.fetch || (()=>Promise.reject(new Error('offline')));
globalThis.window.fetch = globalThis.fetch;
process.on('uncaughtException', e => { console.log('UNCAUGHT:', e.message); console.log((e.stack||'').split('\n').slice(0,4).join('\n')); process.exit(2); });
process.on('unhandledRejection', e => { console.log('REJECTION:', e && e.message || e); });
try {
  await import('file:///tmp/bundle.mjs');
  console.log('MODULE INIT: COMPLETO SIN SYNTAXERROR');
} catch (e) {
  console.log('MODULE INIT ERROR:', e.constructor.name + ':', e.message);
  console.log((e.stack||'').split('\n').slice(0,5).join('\n'));
}
setTimeout(()=>{ console.log('post-init 3s OK'); process.exit(0); }, 3000);
