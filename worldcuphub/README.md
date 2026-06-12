# ⚽ WORLD CUP HUB — remake

Remake del Dressup Lounge / World Cup Hub, con la misma estructura del
original: **client** (React + Vite + Babylon 8 + cannon-es + colyseus.js)
y **server** (Colyseus).

## Correr en dev

```bash
# terminal 1 — server (ws://localhost:2567)
cd server && npm install && npm run dev

# terminal 2 — client (http://localhost:5173)
cd client && npm install && npm run dev
```

Abrí http://localhost:5173 — el cliente intenta conectarse solo:
`?ws=` → `localStorage.maplab_ws` → `window.WCHUB_WS` → mismo host
(http/https) → `ws://localhost:2567` (dev). Si no hay server, sigue
single-player.

## Producción

- `client`: `npm run build` → `dist/` estático (servilo desde tu Worker;
  inyectá `window.WCHUB_WS` o serví el WS en el mismo host).
- `server`: `npm run build && npm start` (o registrá `PatioRoom` en tu
  server existente: `gameServer.define("patio", PatioRoom)`).

## Estructura

```
client/src/game/main.ts    motor del juego (Babylon, vanilla TS)
client/src/game/figura.ts  humanoide procedural (FK, lofts)
client/src/App.tsx         UI React (menú, entrada, HUD, paneles)
client/src/assets/         texturas + BGM del original
server/src/maplab-room.ts  sala "patio" (30 jugadores, relay)
server/src/index.ts        bootstrap Colyseus
```

Multijugador de cuerpo entero: ropa/estampados, cara pintada, caminata,
sentarse, saltar, 24 emotes, chat con globos y pelota compartida.
