// Headless integration smoke: REAL server game layer + bots, no browser.
import { createState, addPlayer, registerMessages, step } from '../../server/src/game';
import { spawnBots, createBotDriver, BOT_DEFS } from '../../server/src/game/bots';

const state = createState('SMOKE');
const goals: any[] = [];
let lastBall: any = null;
const handlers = new Map<string, (c: any, m: any) => void>();
const room = {
  state,
  clients: [] as any[],
  onMessage: (t: string, h: any) => handlers.set(t, h),
  broadcast: (t: string, d: any) => {
    if (t === 'ball:state') lastBall = d;
    if (t === 'ball:goal') goals.push(d);
  },
};
registerMessages(room as any, state);
addPlayer(state, 'me', { name: 'VOS' });
spawnBots(state, addPlayer);
console.log('players:', state.players.size, '| roster:',
  [...state.players.values()].map((p: any) => p.username).join(', '));

// Park the soccer bots near the pitch so the 12s real-time window is enough
// (soccer.ts runs on a real setInterval).
const near = [[157, 30], [160, 35], [156, 36], [150, 28]];
let ni = 0;
for (const d of BOT_DEFS) {
  const p: any = state.players.get(d.sid);
  if (d.soccer && p) { const [x, y] = near[ni++ % near.length]; p.x = x; p.y = y; }
}
const driver = createBotDriver(state, () => lastBall ?? { x: 158, z: 32, vx: 0, vy: 0 });
const input = handlers.get('input')!;
const botClients = new Map(BOT_DEFS.map(d => [d.sid, { sessionId: d.sid, send: () => {} }]));
const iv = setInterval(() => {
  step(state);
  for (const { sid, msg } of driver.tick(Date.now())) input(botClients.get(sid)!, msg);
}, 50);

setInterval(() => {
  if (lastBall) console.log('  t ball', lastBall.x.toFixed(1), lastBall.z.toFixed(1), 'goles', goals.length);
}, 5000);
setTimeout(() => {
  clearInterval(iv);
  const p0: any = state.players.get('bot:0');
  console.log('bot:0 moved to', p0.x.toFixed(1), p0.y.toFixed(1));
  console.log('ball:', lastBall ? `${lastBall.x.toFixed(1)},${lastBall.z.toFixed(1)} score N${lastBall.scoreN}-S${lastBall.scoreS}` : 'never moved');
  console.log('goles:', goals.length, goals.map(g => `${g.scorerName}->${g.side}`).join(' '));
  console.log(goals.length > 0 && lastBall ? 'SMOKE ORIGINAL OK' : 'SMOKE FAIL');
  process.exit(0);
}, 35000);
