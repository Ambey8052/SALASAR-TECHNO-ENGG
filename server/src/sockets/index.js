import { Server } from 'socket.io';
import { env } from '../config/env.js';

let io;

export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });
  return io;
}

export function emitSyncCompleted(syncLog) {
  io?.emit('sync:completed', {
    status: syncLog.status,
    finishedAt: syncLog.finishedAt,
    rowsUpserted: syncLog.rowsUpserted,
    tabsProcessed: syncLog.tabsProcessed,
  });
}
