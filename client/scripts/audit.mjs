import { readFileSync } from 'fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
const src = readFileSync('/tmp/bundle.mjs', 'utf8');
for (const ev of [2020, 2022, 2024, 'latest']) {
  try {
    acorn.parse(src, { ecmaVersion: ev, sourceType: 'module' });
    console.log('ecmaVersion', ev, ': PARSE OK');
  } catch (e) {
    console.log('ecmaVersion', ev, ': FALLA ->', e.message.slice(0, 140));
  }
}
let ast;
try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true }); } catch (e) { process.exit(0); }
let total = 0; const sus = [];
walk.simple(ast, { Literal(n) {
  if (!n.regex) return;
  total++;
  const { pattern, flags } = n.regex;
  let bad = null;
  try { new RegExp(pattern, flags); } catch (e) { bad = e.message; }
  const hasSurr = /\\u[dD][89abAB][0-9a-fA-F]{2}/.test(pattern);
  const hasMod = /\(\?[a-z]*-?[a-z]*:/.test(pattern) && /\(\?[ims]/.test(pattern);
  if (bad || flags.includes('v') || hasSurr || hasMod) {
    sus.push({ line: n.loc.start.line, col: n.loc.start.column, flags, bad, pattern: pattern.slice(0, 110) });
  }
}});
console.log('regex literales totales:', total, '| sospechosas:', sus.length);
for (const s of sus.slice(0, 12)) console.log(JSON.stringify(s));
