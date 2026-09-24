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
