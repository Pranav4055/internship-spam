const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;
const MAX_CLIENTS = 10_000;

export function createAnalysisRateLimit({
  windowMs = WINDOW_MS,
  maxRequests = MAX_REQUESTS,
  maxClients = MAX_CLIENTS,
  now = Date.now,
} = {}) {
  const clients = new Map();

  return function analysisRateLimit(request, response, next) {
    const currentTime = now();
    const clientKey = request.ip || request.socket?.remoteAddress || 'unknown';
    let window = clients.get(clientKey);

    if (!window || window.resetAt <= currentTime) {
      if (!window && clients.size >= maxClients) {
        for (const [key, entry] of clients) {
          if (entry.resetAt <= currentTime) clients.delete(key);
        }
      }
      if (!window && clients.size >= maxClients) {
        const earliestReset = Math.min(...[...clients.values()].map((entry) => entry.resetAt));
        response.set('Retry-After', String(Math.max(1, Math.ceil((earliestReset - currentTime) / 1000))));
        return response.status(429).json({ error: 'Too many analysis requests. Please try again later.' });
      }
      window = { count: 0, resetAt: currentTime + windowMs };
      clients.set(clientKey, window);
    }

    if (window.count >= maxRequests) {
      response.set('Retry-After', String(Math.max(1, Math.ceil((window.resetAt - currentTime) / 1000))));
      return response.status(429).json({ error: 'Too many analysis requests. Please try again later.' });
    }

    window.count += 1;
    return next();
  };
}
