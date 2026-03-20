/**
 * ai-stream-monitor → Prometheus metrics backend
 *
 * Converts SDK JSON events into Prometheus metrics that Grafana can visualize.
 * Import the companion grafana-dashboard.json for a ready-made dashboard.
 *
 * Usage:
 *   npm install express prom-client
 *   npx ts-node examples/backend-prometheus.ts
 *
 * Endpoints:
 *   POST /api/monitor   — SDK event receiver
 *   GET  /metrics        — Prometheus scrape target
 */
import express from 'express';
import { Registry, Histogram, Counter, Gauge } from 'prom-client';

const register = new Registry();

register.setDefaultLabels({ service: 'ai-stream-monitor' });

// ---------------------------------------------------------------------------
// Stream lifecycle metrics
// ---------------------------------------------------------------------------

const streamTTFT = new Histogram({
  name: 'ai_monitor_stream_ttft_seconds',
  help: 'Time to first token (seconds)',
  labelNames: ['app_id', 'model', 'provider'] as const,
  buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const streamTTLB = new Histogram({
  name: 'ai_monitor_stream_ttlb_seconds',
  help: 'Time to last byte — full stream duration (seconds)',
  labelNames: ['app_id', 'model', 'provider'] as const,
  buckets: [1, 3, 5, 10, 30, 60, 120],
  registers: [register],
});

const streamTPS = new Histogram({
  name: 'ai_monitor_stream_tps',
  help: 'Tokens per second at stream completion',
  labelNames: ['app_id', 'model', 'provider'] as const,
  buckets: [5, 10, 20, 40, 80, 150],
  registers: [register],
});

const streamTokens = new Counter({
  name: 'ai_monitor_stream_tokens_total',
  help: 'Cumulative token count',
  labelNames: ['app_id', 'model', 'provider', 'token_type'] as const,
  registers: [register],
});

const streamPhase = new Histogram({
  name: 'ai_monitor_stream_phase_seconds',
  help: 'Duration of a stream phase (thinking, generating, etc.)',
  labelNames: ['app_id', 'phase'] as const,
  buckets: [0.5, 1, 3, 5, 10, 30],
  registers: [register],
});

const streamStalls = new Counter({
  name: 'ai_monitor_stream_stalls_total',
  help: 'Number of stream stall events detected',
  labelNames: ['app_id'] as const,
  registers: [register],
});

const streamErrors = new Counter({
  name: 'ai_monitor_stream_errors_total',
  help: 'Stream errors',
  labelNames: ['app_id', 'model'] as const,
  registers: [register],
});

const streamActive = new Gauge({
  name: 'ai_monitor_stream_active',
  help: 'Currently active streams (started but not yet completed/errored)',
  labelNames: ['app_id'] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Error metrics
// ---------------------------------------------------------------------------

const jsErrors = new Counter({
  name: 'ai_monitor_js_errors_total',
  help: 'Frontend JavaScript errors',
  labelNames: ['app_id', 'error_type'] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// HTTP metrics
// ---------------------------------------------------------------------------

const httpDuration = new Histogram({
  name: 'ai_monitor_http_duration_seconds',
  help: 'HTTP request duration (seconds)',
  labelNames: ['app_id', 'method', 'status'] as const,
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 3, 10],
  registers: [register],
});

// ---------------------------------------------------------------------------
// Web Vitals
// ---------------------------------------------------------------------------

const webVitals = new Gauge({
  name: 'ai_monitor_web_vital_value',
  help: 'Web Vital metric value (latest observation)',
  labelNames: ['app_id', 'metric_name', 'rating'] as const,
  registers: [register],
});

// ---------------------------------------------------------------------------
// Express server
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/monitor', (req, res) => {
  const events: Array<{
    type: string;
    data: Record<string, any>;
    context: Record<string, any>;
  }> = req.body;

  if (!Array.isArray(events)) {
    res.status(400).json({ error: 'expected array' });
    return;
  }

  for (const event of events) {
    const appId = event.context?.appId ?? 'unknown';
    const model = String(event.data?.model ?? 'unknown');
    const provider = String(event.data?.provider ?? 'unknown');
    const d = event.data;

    switch (event.type) {
      // --- stream lifecycle ---
      case 'stream_start':
        streamActive.inc({ app_id: appId });
        break;

      case 'stream_first_token':
        if (typeof d.ttft === 'number') {
          streamTTFT.observe({ app_id: appId, model, provider }, d.ttft / 1000);
        }
        break;

      case 'stream_complete': {
        streamActive.dec({ app_id: appId });
        const m = String(d.model ?? model);
        const p = String(d.provider ?? provider);
        if (typeof d.ttlb === 'number') {
          streamTTLB.observe({ app_id: appId, model: m, provider: p }, d.ttlb / 1000);
        }
        if (typeof d.tps === 'number') {
          streamTPS.observe({ app_id: appId, model: m, provider: p }, d.tps);
        }
        const usage = d.tokenUsage as Record<string, number> | undefined;
        if (usage) {
          if (typeof usage.promptTokens === 'number') {
            streamTokens.inc({ app_id: appId, model: m, provider: p, token_type: 'prompt' }, usage.promptTokens);
          }
          if (typeof usage.completionTokens === 'number') {
            streamTokens.inc({ app_id: appId, model: m, provider: p, token_type: 'completion' }, usage.completionTokens);
          }
        }
        break;
      }

      case 'stream_phase':
        if (d.action === 'end' && typeof d.duration === 'number') {
          streamPhase.observe({ app_id: appId, phase: String(d.phase) }, d.duration / 1000);
        }
        break;

      case 'stream_stall':
        streamStalls.inc({ app_id: appId });
        break;

      case 'stream_error':
        streamActive.dec({ app_id: appId });
        streamErrors.inc({ app_id: appId, model });
        break;

      // --- JS errors ---
      case 'js_error':
      case 'promise_error':
        jsErrors.inc({ app_id: appId, error_type: event.type });
        break;

      // --- HTTP requests ---
      case 'http_request':
        if (typeof d.duration === 'number') {
          httpDuration.observe(
            { app_id: appId, method: String(d.method ?? 'GET'), status: String(d.status ?? 0) },
            d.duration / 1000,
          );
        }
        break;

      // --- Web Vitals ---
      case 'web_vital':
        if (typeof d.value === 'number') {
          webVitals.set(
            { app_id: appId, metric_name: String(d.name), rating: String(d.rating ?? 'unknown') },
            d.value,
          );
        }
        break;
    }
  }

  res.json({ ok: true });
});

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => {
  console.log(`ai-stream-monitor receiver → http://localhost:${PORT}`);
  console.log(`Prometheus scrape target  → http://localhost:${PORT}/metrics`);
});
