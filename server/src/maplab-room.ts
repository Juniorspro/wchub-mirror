// ============================================================================
// maplab-room.ts — sala Colyseus para el ONLINE del remake (maplab).
// Multijugador de CUERPO ENTERO: relay de pos/anim a 10Hz, outfit y cara
// cacheados (se reenvían a quien entra), chat, emotes y pelota compartida
// (el último que patea es la autoridad). Para activarlo:
//
//   import { PatioRoom } from "./maplab-room";
//   gameServer.define("patio", PatioRoom);
//
// El cliente se conecta con ?ws=wss://tu-server (o localStorage
// 'maplab_ws') y se une a la sala "patio" automáticamente.
// ============================================================================
import { Room, Client } from "colyseus";

interface Cached {
  state?: unknown;
  face?: unknown;
}

export class PatioRoom extends Room {
  maxClients = 20; // mismo cap que el juego original
  private cache = new Map<string, Cached>();

  onCreate(): void {
    this.autoDispose = true;
    // posición + animación (caminata/salto/sentado) — relay puro a 10Hz
    this.onMessage("pos", (client: Client, data: unknown) => {
      const d = data as Record<string, unknown>;
      this.broadcast("pos", {
        id: client.sessionId,
        x: Number(d?.x) || 0,
        z: Number(d?.z) || 0,
        yaw: Number(d?.yaw) || 0,
        m: Number(d?.m) || 0,
        sy: Number(d?.sy) || 0,
        sit: Number(d?.sit) || 0,
        wph: Number(d?.wph) || 0,
        name: String(d?.name || "wacho").slice(0, 14),
      }, { except: client });
    });
    // outfit (ropa/sombrero/anteojos/bufanda) — cacheado para nuevos
    this.onMessage("state", (client: Client, data: unknown) => {
      const c = this.cache.get(client.sessionId) || {};
      c.state = data;
      this.cache.set(client.sessionId, c);
      this.broadcast("state", { id: client.sessionId, ...(data as object) }, { except: client });
    });
    // cara pintada (jpeg base64, viaja una vez) — cacheada para nuevos
    this.onMessage("face", (client: Client, data: unknown) => {
      const c = this.cache.get(client.sessionId) || {};
      c.face = data;
      this.cache.set(client.sessionId, c);
      this.broadcast("face", { id: client.sessionId, ...(data as object) }, { except: client });
    });
    this.onMessage("emote", (client: Client, idx: unknown) => {
      this.broadcast("emote", { id: client.sessionId, i: Number(idx) | 0 }, { except: client });
    });
    this.onMessage("chat", (client: Client, txt: unknown) => {
      this.broadcast("chat", {
        id: client.sessionId,
        txt: String(txt).slice(0, 64),
      }, { except: client });
    });
    // pelota compartida: el que pateó último manda su estado
    this.onMessage("ball", (client: Client, data: unknown) => {
      this.broadcast("ball", data, { except: client });
    });
  }

  onJoin(client: Client): void {
    // al que entra le mando el outfit y la cara de los que ya están
    for (const [id, c] of this.cache) {
      if (id === client.sessionId) continue;
      if (c.state) client.send("state", { id, ...(c.state as object) });
      if (c.face) client.send("face", { id, ...(c.face as object) });
    }
  }

  onLeave(client: Client): void {
    this.cache.delete(client.sessionId);
    this.broadcast("leave", client.sessionId);
  }
}
