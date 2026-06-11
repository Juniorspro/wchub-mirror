import { readFileSync, writeFileSync } from 'fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
const src = readFileSync('/tmp/bundle.mjs', 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const out = [];
walk.simple(ast, { Literal(n){ if(n.regex) out.push([n.regex.pattern, n.regex.flags, n.start]); } });
writeFileSync('/tmp/regexes.json', JSON.stringify(out));
console.log('regexes:', out.length, '| json bytes:', JSON.stringify(out).length);
