// ============================================================================
// index.ts — server Colyseus del WORLD CUP HUB (remake).
// Salas "patio" de 30: joinOrCreate llena la que tenga lugar y el
// matchmaker crea una nueva cuando están completas.
// ============================================================================
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { PatioRoom } from "./maplab-room";

const PORT = Number(process.env.PORT || 2567);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: createServer() }),
});

gameServer.define("patio", PatioRoom);

gameServer.listen(PORT).then(() => {
  console.log(`⚽ WORLD CUP HUB server escuchando en ws://localhost:${PORT}`);
});
