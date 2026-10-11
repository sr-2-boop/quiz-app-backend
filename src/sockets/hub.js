// Holds the Socket.IO server so services can emit without importing the HTTP layer.
// Every helper is a no-op when sockets aren't running (unit/integration tests).

/** @type {import('socket.io').Server | null} */
let io = null;

export function setIo(server) {
  io = server;
}

export function getIo() {
  return io;
}

export const rooms = {
  user: (participantId) => `user:${participantId}`,
  section: (section) => `section:${section}`,
  allParticipants: 'participants',
  admins: 'admins',
  testAdmin: (testId) => `test:${testId}:admin`,
  testBoard: (testId) => `test:${testId}:board`,
};

export function roomSize(room) {
  return io?.sockets.adapter.rooms.get(room)?.size ?? 0;
}

/** Disconnect a participant's sockets, except those belonging to `keepSid` (the current session). */
export async function disconnectUserSockets(participantId, { keepSid = null, reason = 'session_revoked' } = {}) {
  if (!io) return;
  const sockets = await io.in(rooms.user(participantId)).fetchSockets();
  for (const socket of sockets) {
    if (keepSid && socket.data.user?.sid === keepSid) continue;
    socket.emit('session:revoked', { reason });
    socket.disconnect(true);
  }
}
