let ws = null;
let wsUrl = null;
let state = 'idle';
const ports = new Set();

function broadcast(msg) {
  for (const p of ports) {
    try { p.postMessage(msg); } catch {}
  }
}

function setState(next, extra = {}) {
  state = next;
  broadcast({ type: 'relay.status', state, url: wsUrl || '', ...extra });
}

function connect(url) {
  const target = String(url || '').trim();
  if (!target) throw new Error('missing url');

  if (ws && wsUrl === target && ws.readyState === WebSocket.OPEN) {
    setState('open');
    return;
  }

  try { if (ws) ws.close(); } catch {}
  ws = null;

  wsUrl = target;
  setState('connecting');

  ws = new WebSocket(wsUrl);

  ws.onopen = () => setState('open');
  ws.onerror = () => setState('error');
  ws.onclose = (e) => {
    setState('closed', { code: e?.code ?? null, reason: e?.reason ?? '' });
    ws = null;
  };

  ws.onmessage = (e) => {
    broadcast({ type: 'relay.rx', data: e.data, url: wsUrl });
  };
}

function send(frame) {
  if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('relay not open');
  ws.send(String(frame));
}

onconnect = (e) => {
  const port = e.ports[0];
  ports.add(port);

  port.onmessage = (ev) => {
    const msg = ev.data || {};
    try {
      if (msg.type === 'relay.connect') {
        connect(msg.url);
        port.postMessage({ type: 'relay.ack', ok: true });
        return;
      }
      if (msg.type === 'relay.send') {
        send(msg.frame);
        port.postMessage({ type: 'relay.ack', ok: true });
        return;
      }
      if (msg.type === 'relay.status') {
        port.postMessage({ type: 'relay.status', state, url: wsUrl || '' });
        return;
      }
      if (msg.type === 'relay.close') {
        try { if (ws) ws.close(); } catch {}
        ws = null;
        setState('closed');
        port.postMessage({ type: 'relay.ack', ok: true });
        return;
      }
    } catch (err) {
      port.postMessage({ type: 'relay.ack', ok: false, error: String(err?.message || err) });
    }
  };

  port.start();
  port.postMessage({ type: 'relay.status', state, url: wsUrl || '' });
};
