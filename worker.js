import { DurableObject } from "cloudflare:workers";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts[0] !== "room" || !parts[1]) {
      return new Response("Not found", { status: 404 });
    }

    const roomId = parts[1];

    const id = env.ROOMS.idFromName(roomId);
    const stub = env.ROOMS.get(id);

    return stub.fetch(request);
  }
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sessions = new Map();
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name") || "Anonymous";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    server.accept();

    const sessionId = crypto.randomUUID();

    this.sessions.set(sessionId, {
      ws: server,
      name
    });

    this.broadcast(
      {
        type: "joined",
        user: name
      },
      sessionId
    );

    this.broadcast({
      type: "members",
      members: [...this.sessions.values()].map(s => s.name)
    });

    server.addEventListener("message", evt => {
      try {
        this.broadcast(JSON.parse(evt.data), sessionId);
      } catch {}
    });

    server.addEventListener("close", () => {
      this.sessions.delete(sessionId);

      this.broadcast(
        {
          type: "left",
          user: name
        },
        sessionId
      );

      this.broadcast({
        type: "members",
        members: [...this.sessions.values()].map(s => s.name)
      });
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  broadcast(message, exclude) {
    const data = JSON.stringify(message);

    for (const [id, session] of this.sessions) {
      if (id === exclude) continue;

      try {
        session.ws.send(data);
      } catch {}
    }
  }
}
