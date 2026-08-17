import { useEffect } from 'react';
import { io } from 'socket.io-client';

let socket;

function getSocket() {
  if (!socket) {
    socket = io('/', { withCredentials: true, autoConnect: true });
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
