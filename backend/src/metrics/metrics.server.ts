import { createServer, type Server } from 'node:http';
import { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { MetricsService } from './metrics.service';

/**
 * Serves Prometheus text on a SEPARATE port from the API.
 *
 * The public ingress routes `api.hrcopilot.cloud` to the API port only, so a
 * listener on this second port is reachable from inside the cluster and from
 * nowhere else. That is the whole point: `/metrics` describes provider sync
 * health, queue depth and index backlog — operational detail that has no
 * business being on the public internet, and which would otherwise need an
 * auth scheme of its own to protect.
 *
 * Failures here are contained: if the metrics listener cannot start, it logs
 * and the API keeps serving. Monitoring going blind is bad; taking the
 * product down to protect monitoring would be worse.
 */
export function startMetricsServer(
  app: INestApplication,
  port: number,
): Server | null {
  const logger = new Logger('MetricsServer');
  let metrics: MetricsService;
  try {
    metrics = app.get(MetricsService);
  } catch {
    logger.warn('Metrics service unavailable; metrics endpoint not started.');
    return null;
  }

  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found\n');
      return;
    }
    void metrics
      .scrape()
      .then((body) => {
        res.writeHead(200, { 'Content-Type': metrics.registry.contentType });
        res.end(body);
      })
      .catch(() => {
        // Never leak an internal error message onto an unauthenticated port.
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('metrics collection failed\n');
      });
  });

  server.on('error', (error: Error) => {
    logger.warn(`Metrics endpoint failed: ${error.message}`);
  });

  server.listen(port, () => {
    logger.log(`Metrics listening on port ${port} (cluster-internal only)`);
  });

  return server;
}
