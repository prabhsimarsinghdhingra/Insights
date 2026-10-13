// WebSocket hub: authenticates the handshake with a one-time ticket, sends a
// snapshot on connect, then fans engine messages out to every client.
//
// Wire format (JSON text frames, server -> client only):
//   { "type": "snapshot" | "telemetry.event" | "telemetry.status" |
//             "alert.created" | "alert.updated" | "alert.resolved",
//     "ts": ISO-8601, "data": {...} }
// Clients are not expected to send anything; inbound frames are ignored and
// capped at 1 KB.

import { WebSocketServer } from 'ws';

const reject = (socket, status, text) => {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
};

export function createWsHub({
  server,
  engine,
  tickets,
  path = '/ws/alerts',
  allowedOrigin,
  maxClients = 200,
  heartbeatMs = 30_000,
  maxBufferedBytes = 1_000_000,
  logger = console,
}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  const onUpgrade = (req, socket, head) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      return reject(socket, 400, 'Bad Request');
    }
    if (url.pathname !== path) return socket.destroy();

    // Browsers always send Origin; non-browser clients (scripts, tests) do not.
    const origin = req.headers.origin;
    if (origin && allowedOrigin && origin !== allowedOrigin) return reject(socket, 403, 'Forbidden');

    const user = tickets.redeem(url.searchParams.get('ticket'));
    if (!user) return reject(socket, 401, 'Unauthorized');
    if (wss.clients.size >= maxClients) return reject(socket, 503, 'Service Unavailable');

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', () => { /* server-push only */ });
      ws.on('error', (err) => logger.warn?.('ws client error:', err.message));
      ws.send(JSON.stringify({ type: 'snapshot', ts: new Date().toISOString(), data: engine.snapshot() }));
    });
  };
  server.on('upgrade', onUpgrade);

  const unsubscribe = engine.subscribe((message) => {
    const frame = JSON.stringify(message);
    for (const ws of wss.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if (ws.bufferedAmount > maxBufferedBytes) { ws.terminate(); continue; } // slow consumer
      ws.send(frame);
    }
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    clientCount: () => wss.clients.size,
    close() {
      clearInterval(heartbeat);
      unsubscribe();
      server.off('upgrade', onUpgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
