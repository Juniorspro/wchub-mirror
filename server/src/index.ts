import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { createServer } from "http";
import { GameRoom, roomRuntimeStats } from "./room";
import { gameConfig, serializeClientConfig } from "./game.config";

const PORT = Number(process.env.PORT ?? gameConfig.port);

const httpServer = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (req.url === "/stats") {
    res.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(roomRuntimeStats));
    return;
  }
  // Standalone-local mode (no Worker): serve the client config the same way
  // the Worker does, so client/index.html can read window.GAME_CONFIG.
  if (req.url === "/game.config.js") {
    res.writeHead(200, {
      "content-type": "application/javascript",
      "cache-control": "no-store",
    });
    res.end(serializeClientConfig());
    return;
  }
  res.writeHead(404);
  res.end();
});

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// `filterBy: ["code"]` makes joinOrCreate match an existing room when the
// supplied `code` equals the room's metadata.code — so two players who share
// the same code land in the same room, even if multiple rooms coexist in
// this process.
gameServer.define(gameConfig.roomName, GameRoom).filterBy(["code"]);

gameServer.listen(PORT).then(() => {
  console.log(`[colyseus] listening on :${PORT}`);
});

const shutdown = async (sig: string) => {
  console.log(`[colyseus] received ${sig}, draining…`);
  await gameServer.gracefullyShutdown();
  process.exit(0);
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
