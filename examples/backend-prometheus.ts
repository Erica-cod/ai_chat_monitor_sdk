/**
 * Prometheus 格式转换示例 — 把 SDK 上报的 JSON 转为 Prometheus 指标
 * 适合已有 Grafana + Prometheus 基础设施的团队
 *
 * npm install express prom-client
 * npx ts-node examples/backend-prometheus.ts
 *
 * Prometheus 拉取: http://localhost:3001/metrics
 */
import express from 'express';
import { Registry, Histogram, Counter } from 'prom-client';

const register = new Registry();

const sseLatency = new Histogram({
  name: 'ai_sse_ttfb_ms',
  help: 'SSE Time To First Byte (ms)',
  labelNames: ['app_id'],
  buckets: [100, 500, 1000, 2000, 5000, 10000],
  registers: [register],
});

const sseTTLB = new Histogram({
  name: 'ai_sse_ttlb_ms',
  help: 'SSE Time To Last Byte (ms)',
  labelNames: ['app_id'],
  buckets: [1000, 3000, 5000, 10000, 30000, 60000],
  registers: [register],
});

const errorCount = new Counter({
  name: 'ai_frontend_errors_total',
  help: 'Frontend error count',
  labelNames: ['app_id', 'type'],
  registers: [register],
});

const app = express();
app.use(express.json({ limit: '1mb' }));

app.post('/api/monitor', (req, res) => {
  const events = req.body;

  for (const event of events) {
    const appId = event.context?.appId ?? 'unknown';

    switch (event.type) {
      case 'stream_first_token':
        if (event.data.ttft) sseLatency.observe({ app_id: appId }, event.data.ttft as number);
        break;
      case 'stream_complete':
        if (event.data.ttlb) sseTTLB.observe({ app_id: appId }, event.data.ttlb as number);
        break;
      case 'js_error':
      case 'promise_error':
        errorCount.inc({ app_id: appId, type: event.type });
        break;
    }
  }

  res.json({ ok: true });
});

// Prometheus 拉取端点
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(3001, () => {
  console.log('Monitor + Prometheus metrics on http://localhost:3001');
});
