import { NextRequest } from "next/server";

const clients = new Set<WebSocket>();

export const GET = (req: NextRequest) => {
  // @ts-ignore
  const { socket } = req;

  if (!socket) {
    return new Response("Expected WebSocket upgrade", { status: 400 });
  }

  // @ts-ignore
  socket.upgrade((ws: WebSocket) => {
    clients.add(ws);

    ws.addEventListener("message", (event) => {
      // Broadcast to all other clients
      for (const client of clients) {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
          client.send(event.data);
        }
      }
    });

    ws.addEventListener("close", () => {
      clients.delete(ws);
    });
  });

  return new Response(null, { status: 101 });
};
