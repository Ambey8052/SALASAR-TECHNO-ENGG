import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env, isAllowedLogin } from '../config/env.js';

let io;

function readSessionCookie(header) {
  for (const part of (header || '').split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'session') return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  // Sync events go only to signed-in users. The socket used to accept anyone, and broadcast
  // each run's status, row counts and tab names to them. The browser sends the session cookie
  // with the handshake (the client connects withCredentials), so it is checked the same way
  // middleware/auth.js checks an API request.
  io.use((socket, next) => {
    try {
      const claims = jwt.verify(readSessionCookie(socket.handshake.headers.cookie), env.jwtSecret);
      if (!isAllowedLogin(claims.email)) return next(new Error('Not authorized'));
      return next();
    } catch {
      return next(new Error('Not authenticated'));
    }
  });

  return io;
}

export function emitSyncCompleted(syncLog) {
  io?.emit('sync:completed', {
    status: syncLog.status,
    finishedAt: syncLog.finishedAt,
    rowsUpserted: syncLog.rowsUpserted,
    tabsProcessed: syncLog.tabsProcessed,
    trigger: syncLog.trigger,
  });
}
