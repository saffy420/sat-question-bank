import { createServer, connect } from 'node:net';

export async function setOffline(context, offline) {
  await context.setOffline(offline);
}

// CDP units: latency milliseconds; throughput bytes per second (400 kbps down, 400 kbps up).
export const SLOW_3G = Object.freeze({ offline: false, latency: 400, downloadThroughput: 50 * 1024, uploadThroughput: 50 * 1024 });
export async function throttle(page, profile = SLOW_3G) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', profile);
  return { profile, async restore() { await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await cdp.detach(); } };
}

// CDP emulation does not delay WebSocket frames in Chromium (measured: ~37 ms ping RTT
// under SLOW_3G). This TCP relay shapes every byte instead: half the round-trip latency
// each way plus a per-direction byte rate. TLS stays end to end; point a context's
// baseURL at the returned origin to put it behind the relay.
export async function shapedOrigin(profile = SLOW_3G, target = 8787) {
  const sockets = new Set();
  // One ordered queue per direction: separate timers can fire out of order and corrupt TLS.
  const pipe = (from, to, rate) => {
    const queue = [];
    let free = 0, timer = null, ended = false;
    const pump = () => {
      timer = null;
      while (queue.length && queue[0].at <= Date.now()) { const { chunk } = queue.shift(); if (!to.destroyed) to.write(chunk); }
      if (queue.length) timer = setTimeout(pump, queue[0].at - Date.now());
      else if (ended) to.destroy();
    };
    from.on('data', chunk => {
      const now = Date.now();
      free = Math.max(free, now) + chunk.length / rate * 1000;
      queue.push({ at: free + profile.latency / 2, chunk });
      if (!timer) timer = setTimeout(pump, queue[0].at - now);
    });
    from.on('close', () => { ended = true; if (!timer) pump(); });
  };
  const server = createServer(client => {
    const upstream = connect(target, '127.0.0.1');
    for (const s of [client, upstream]) { sockets.add(s); s.on('error', () => s.destroy()); s.on('close', () => sockets.delete(s)); }
    pipe(client, upstream, profile.uploadThroughput);
    pipe(upstream, client, profile.downloadThroughput);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { profile, origin: `https://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }) };
}
