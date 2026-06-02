#!/usr/bin/env node
// 3D template architecture self-check: freezes the Babylon runtime, the
// React canvas shell, and the extension-tag invariants.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC_DIR = join(ROOT, 'src');
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
const REQUIRED_EXTENSION_MARKERS = [
  'LLM-EXTENSION:CONFIG',
  'LLM-EXTENSION:WORLD',
  'LLM-EXTENSION:ACTOR',
  'LLM-EXTENSION:ITEMS',
  'LLM-EXTENSION:ENTITIES',
  'LLM-EXTENSION:HUD',
  'LLM-EXTENSION:SCHEMA',
];
const REQUIRED_FILES = [
  'src/App.tsx',
  'src/babylon/game.ts',
  'src/babylon/helpers.ts',
  'src/babylon/world.ts',
  'src/babylon/actor.ts',
  'src/babylon/items.ts',
  'src/babylon/entities.ts',
  'src/babylon/hud.tsx',
  'src/babylon/store.ts',
  'src/game/schema.ts',
];
const FORBIDDEN_IMPORT_SOURCES = [
  '@react' + '-three/fiber',
  '@react' + '-three/drei',
  'three',
];
const HOT_FUNCTION_NAMES = new Set(['update', 'runRenderLoop']);
const HOT_PATH_ALLOCATION_PATTERNS = [
  /new\s+Vector[234]\s*\(/,
  /new\s+Color[34]\s*\(/,
  /new\s+Matrix\s*\(/,
  /Matrix\.Identity\s*\(/,
  /Quaternion\.Identity\s*\(/,
  /new\s+Float32Array\s*\(/,
  /new\s+Array\s*\(/,
  /return\s*\{/,
];

function sourceFiles(dir) {
  const output = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...sourceFiles(path));
    else if (SOURCE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))) output.push(path);
  }
  return output;
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function rel(path) {
  return relative(ROOT, path);
}

function fail(errors, message) {
  errors.push(`- ${message}`);
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function stripCommentsAndStrings(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/`(?:\\.|[^`])*`/g, '``')
    .replace(/'(?:\\.|[^'])*'/g, "''")
    .replace(/"(?:\\.|[^"])*"/g, '""');
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return index;
  }
  return -1;
}

function hotFunctionBodies(text) {
  const bodies = [];
  const functionPattern = /(?:function\s+)?([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{/g;
  for (const match of text.matchAll(functionPattern)) {
    const name = match[1] ?? '';
    const before = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    const isRunRenderLoopCallback = before.includes('runRenderLoop');
    const isNamedHotFunction = HOT_FUNCTION_NAMES.has(name);
    if (!isRunRenderLoopCallback && !isNamedHotFunction) continue;
    const openIndex = (match.index ?? 0) + match[0].lastIndexOf('{');
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex > openIndex) bodies.push(text.slice(openIndex, closeIndex + 1));
  }
  const methodPattern = /\b(update)\s*\([^)]*\)\s*\{/g;
  for (const match of text.matchAll(methodPattern)) {
    const openIndex = (match.index ?? 0) + match[0].lastIndexOf('{');
    const closeIndex = findMatchingBrace(text, openIndex);
    if (closeIndex > openIndex) bodies.push(text.slice(openIndex, closeIndex + 1));
  }
  return bodies;
}

const files = sourceFiles(SRC_DIR);
const fileText = new Map(files.map((path) => [path, read(path)]));
// Strip per file first, then join. Joining raw sources before strip lets a
// stray block-comment opener in one file greedily swallow code in later files
// until the next closing token, which would silently hide required keywords
// across the join.
const strippedByFile = new Map([...fileText].map(([path, text]) => [path, stripCommentsAndStrings(text)]));
const allCode = [...strippedByFile.values()].join('\n');
const errors = [];

for (const requiredPath of REQUIRED_FILES) {
  if (!existsSync(join(ROOT, requiredPath))) fail(errors, `${requiredPath} must exist as part of the Babylon 3D template main path`);
}

for (const marker of REQUIRED_EXTENSION_MARKERS) {
  const hits = files.filter((path) => fileText.get(path).includes(marker));
  if (hits.length !== 1) {
    fail(errors, `${marker} must appear exactly once across the src tree; currently found ${hits.length} occurrence(s): ${hits.map(rel).join(', ') || 'none'}`);
  }
}

const appText = fileText.get(join(ROOT, 'src/App.tsx')) ?? '';
const gameText = fileText.get(join(ROOT, 'src/babylon/game.ts')) ?? '';
const helpersText = fileText.get(join(ROOT, 'src/babylon/helpers.ts')) ?? '';
const schemaText = fileText.get(join(ROOT, 'src/game/schema.ts')) ?? '';

if (!/<canvas\b[^>]*ref=\{canvasRef\}/.test(appText)) {
  fail(errors, 'src/App.tsx must mount a native canvas shell with a canvasRef');
}
if (!/startGame\(\s*canvas\s*,\s*runtimeContext\s*\)/.test(appText)) {
  fail(errors, 'src/App.tsx must call startGame(canvas, runtimeContext)');
}
if (!/\.dispose\s*\(\s*\)/.test(appText)) {
  fail(errors, 'src/App.tsx cleanup must call the Babylon runtime handle.dispose()');
}
if (/(?:new\s+Scene\s*\(|new\s+Engine\s*\(|runRenderLoop\s*\()/.test(stripCommentsAndStrings(appText))) {
  fail(errors, 'src/App.tsx must remain a thin React shell — it cannot create the Engine/Scene or a render loop');
}

const runLoopCalls = countMatches(allCode, /\.runRenderLoop\s*\(/g);
if (runLoopCalls !== 1 || !/engine\.runRenderLoop\s*\(/.test(stripCommentsAndStrings(gameText))) {
  fail(errors, `engine.runRenderLoop() must appear exactly once in src/babylon/game.ts; currently ${runLoopCalls} occurrence(s)`);
}
const startGameDefinitions = countMatches(allCode, /export\s+function\s+startGame\s*\(/g);
if (startGameDefinitions !== 1 || !/export\s+function\s+startGame\s*\(\s*canvas\s*:\s*HTMLCanvasElement/.test(gameText)) {
  fail(errors, `startGame(canvas: HTMLCanvasElement, ...) must be exported exactly once from src/babylon/game.ts; currently ${startGameDefinitions} occurrence(s)`);
}
if (!/new\s+Engine\s*\(\s*canvas\b/.test(gameText) || !/new\s+Scene\s*\(\s*engine\s*\)/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts must create the Babylon Engine(canvas) and Scene(engine)');
}
if (!/Math\.min\s*\([\s\S]{0,120}0\.05\s*\)/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts render loop must clamp dt to avoid large steps after returning from background');
}
if (!/scene\.render\s*\(\s*\)/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts render loop must call scene.render()');
}
if (!/window\.addEventListener\s*\(\s*['"]resize['"]/.test(gameText) || !/window\.removeEventListener\s*\(\s*['"]resize['"]/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts must register and remove the resize listener in pairs');
}
for (const pattern of [/engine\.stopRenderLoop\s*\(/, /scene\.dispose\s*\(/, /engine\.dispose\s*\(/, /scene\.disablePhysicsEngine\s*\(/]) {
  if (!pattern.test(gameText)) fail(errors, `src/babylon/game.ts dispose path is missing ${pattern}`);
}

if (!/import\s+HavokPhysics\s+from\s+['"]@babylonjs\/havok['"]/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts must import HavokPhysics from @babylonjs/havok at the top level');
}
if (!/await\s+HavokPhysics\s*\(\s*\)/.test(gameText)) {
  fail(errors, 'HavokPhysics() must be awaited before the physics plugin is created');
}
if (!/new\s+HavokPlugin\s*\(/.test(gameText) || !/scene\.enablePhysics\s*\(/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts must wire physics or its degraded fallback through HavokPlugin + scene.enablePhysics');
}

if (!/from\s+['"]@babylonjs\/core['"]/.test(gameText) || !/\bEngine\b/.test(gameText) || !/\bScene\b/.test(gameText)) {
  fail(errors, 'src/babylon/game.ts must import Babylon Engine / Scene from @babylonjs/core');
}
if (!/from\s+['"]@babylonjs\/core['"]/.test(helpersText) || !/StandardMaterial/.test(helpersText)) {
  fail(errors, 'src/babylon/helpers.ts must consolidate the Babylon helpers and the default StandardMaterial');
}
if (!/thinInstanceSetBuffer\s*\(/.test(helpersText) || !/thinInstanceBufferUpdated\s*\(/.test(helpersText)) {
  fail(errors, 'src/babylon/helpers.ts must keep the thinInstance helper for the repeated-object performance path');
}
if (!/setHardwareScalingLevel\s*\(/.test(helpersText)) {
  fail(errors, 'src/babylon/helpers.ts must keep the mobile hardware scaling fallback');
}

for (const [path, code] of strippedByFile) {
  const relativePath = rel(path);
  for (const source of FORBIDDEN_IMPORT_SOURCES) {
    const importPattern = new RegExp(`from\\s+['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]|import\\s+['"]${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
    if (importPattern.test(code)) fail(errors, `${relativePath} must not import the legacy 3D render package: ${source}`);
  }
  if (/\brequire\s*\(/.test(code)) fail(errors, `${relativePath} must not use require() in a browser template`);
}

for (const [path, code] of strippedByFile) {
  const relativePath = rel(path);
  for (const body of hotFunctionBodies(code)) {
    for (const pattern of HOT_PATH_ALLOCATION_PATTERNS) {
      if (pattern.test(body)) fail(errors, `${relativePath} render/update hot path contains a visible allocation: ${pattern}`);
    }
  }
}

if (!/useGameConfig\s*\(\s*SCHEMA\s*\)/.test(appText) || !/useInput\s*\(/.test(appText) || !/useScreen\s*\(/.test(appText)) {
  fail(errors, 'src/App.tsx must keep the @rezona/core/3d screen/input/config platform hooks wired');
}
if (!/\.\.\.\s*\{?\s*input\.handlers\s*\}?/.test(appText)) {
  fail(errors, 'src/App.tsx must attach input.handlers to the DOM container or an equivalent input path — keyboard fallback alone is not enough');
}
const hasLocomotionOrActionPath = /\binput\.dir\b|\binput\.actionHeld\b|\bsetActionHeld\s*\(/.test(allCode);
const hasDomControlPath = /MobileControlHud|setMobileMove\s*\(|setActionHeld\s*\(/.test(allCode);
if (hasLocomotionOrActionPath && !hasDomControlPath) {
  fail(errors, 'When a character / vehicle movement or action path is present, MobileControlHud or an equivalent mobile DOM control main path must be retained');
}
if (!/satisfies\s+EditableSchema/.test(schemaText)) {
  fail(errors, 'src/game/schema.ts must keep exposing its editable config via EditableSchema');
}

if (errors.length > 0) {
  console.error('3D Babylon template architecture self-check failed:');
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('3D Babylon template architecture self-check passed.');
