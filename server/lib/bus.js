// Barramento de eventos em tempo real (enviado ao app por SSE)
const clients = new Set();
export function subscribe(fn) { clients.add(fn); return () => clients.delete(fn); }
export function emit(event, data) { for (const fn of clients) fn(event, data); }
