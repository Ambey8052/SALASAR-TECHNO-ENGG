import { useEffect } from 'react';
import { io } from 'socket.io-client';

let socket;

function getSocket() {
  if (!socket) {
    // Same cross-origin concern as api.js: '/' only reaches the server when they share an
    // origin (local dev, via Vite's proxy). In production this must be the Render URL.
    const base = import.meta.env.VITE_API_URL || '/';
    socket = io(base, { withCredentials: true, autoConnect: true });
  }
  return socket;
}

export function useSyncSocket(onSyncCompleted) {
  useEffect(() => {
    const s = getSocket();
    s.on('sync:completed', onSyncCompleted);
    return () => {
      s.off('sync:completed', onSyncCompleted);
    };
  }, [onSyncCompleted]);
}
