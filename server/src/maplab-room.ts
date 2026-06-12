// ============================================================================
// maplab-room.ts — sala Colyseus para el ONLINE del remake (maplab).
// Protocolo liviano sin Schema: relay de mensajes 'pos' y 'chat' a 10Hz
// (el cliente interpola). Para activarlo en el server existente:
//
//   import { PatioRoom } from "./maplab-room";
//   gameServer.define("patio", PatioRoom);
//
// El cliente del remake se conecta con  ?ws=wss://tu-server  (o
// localStorage 'maplab_ws') y se une a la sala "patio" automáticamente.
// ============================================================================
import { Room, Client } from "colyseus";

export class PatioRoom extends Room {
  maxClients = 20; // mismo cap que el juego original

  onCreate(): void {
    this.autoDispose = true;
    this.onMessage("pos", (client: Client, data: unknown) => {
      const d = data as { x?: number; z?: number; yaw?: number; name?: string };
      this.broadcast("pos", {
        id: client.sessionId,
        x: Number(d?.x) || 0,
        z: Number(d?.z) || 0,
        yaw: Number(d?.yaw) || 0,
        name: String(d?.name || "wacho").slice(0, 14),
      }, { except: client });
    });
    this.onMessage("chat", (client: Client, txt: unknown) => {
      this.broadcast("chat", {
        id: client.sessionId,
        txt: String(txt).slice(0, 64),
      }, { except: client });
    });
  }

  onLeave(client: Client): void {
    this.broadcast("leave", client.sessionId);
  }
}
