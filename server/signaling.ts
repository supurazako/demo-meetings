import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

type ClientMessage =
  | { type: "join"; roomId: string; name: string }
  | { type: "offer"; targetId: string; description: unknown }
  | { type: "answer"; targetId: string; description: unknown }
  | { type: "ice-candidate"; targetId: string; candidate: unknown }
  | { type: "leave" };

type PeerInfo = {
  id: string;
  name: string;
};

type Client = PeerInfo & {
  ws: WebSocket;
  roomId: string;
};

const port = Number(process.env.SIGNALING_PORT ?? process.env.PORT ?? 3001);
const rooms = new Map<string, Map<string, Client>>();

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  res.end("demo-meetings signaling server\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  let client: Client | null = null;

  ws.on("message", (raw) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: "error", message: "Invalid signaling message." });
      return;
    }

    if (message.type === "join") {
      const roomId = sanitizeRoom(message.roomId);
      const name = sanitizeName(message.name);
      const id = randomUUID();
      const room = getRoom(roomId);
      const peers = [...room.values()].map(({ id: peerId, name: peerName }) => ({
        id: peerId,
        name: peerName,
      }));

      client = { id, name, roomId, ws };
      room.set(id, client);

      send(ws, { type: "welcome", id, peers });
      broadcast(roomId, id, { type: "peer-joined", peer: { id, name } });
      return;
    }

    if (!client) {
      send(ws, { type: "error", message: "Join a room before signaling." });
      return;
    }

    if (message.type === "leave") {
      disconnect(client);
      client = null;
      return;
    }

    if (
      message.type === "offer" ||
      message.type === "answer" ||
      message.type === "ice-candidate"
    ) {
      relay(client, message);
    }
  });

  ws.on("close", () => {
    if (client) {
      disconnect(client);
      client = null;
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`signaling server listening on 0.0.0.0:${port}`);
});

function getRoom(roomId: string) {
  const existing = rooms.get(roomId);
  if (existing) {
    return existing;
  }
  const room = new Map<string, Client>();
  rooms.set(roomId, room);
  return room;
}

function relay(
  sender: Client,
  message:
    | Extract<ClientMessage, { type: "offer" }>
    | Extract<ClientMessage, { type: "answer" }>
    | Extract<ClientMessage, { type: "ice-candidate" }>,
) {
  const room = rooms.get(sender.roomId);
  const target = room?.get(message.targetId);
  if (!target) {
    send(sender.ws, { type: "error", message: "Peer is no longer available." });
    return;
  }

  if (message.type === "ice-candidate") {
    send(target.ws, {
      type: "ice-candidate",
      fromId: sender.id,
      candidate: message.candidate,
    });
    return;
  }

  send(target.ws, {
    type: message.type,
    fromId: sender.id,
    description: message.description,
  });
}

function disconnect(client: Client) {
  const room = rooms.get(client.roomId);
  if (!room) {
    return;
  }
  room.delete(client.id);
  broadcast(client.roomId, client.id, { type: "peer-left", id: client.id });
  if (room.size === 0) {
    rooms.delete(client.roomId);
  }
}

function broadcast(roomId: string, exceptId: string, payload: unknown) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  for (const peer of room.values()) {
    if (peer.id !== exceptId) {
      send(peer.ws, payload);
    }
  }
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sanitizeRoom(value: string) {
  const room = value.trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  return room || "demo";
}

function sanitizeName(value: string) {
  const name = value.trim().slice(0, 32);
  return name || "Guest";
}
