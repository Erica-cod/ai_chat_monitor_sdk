# ai-stream-monitor

> Lightweight, tree-shakeable monitoring SDK built specifically for AI chat applications. Tracks streaming lifecycle metrics (TTFT, TTLB, TPS), thinking/generating phases, tool call chains, and errors. Full bundle ~12 KB gzipped, individual plugins under 1.5 KB each.

## Why ai-stream-monitor?

Generic monitoring tools like Sentry and LogRocket treat AI streaming responses as ordinary HTTP requests. They capture when a request starts and ends, but miss everything in between — the moment the first token arrives, how long the model spends "thinking" vs "generating", whether a tool call stalled, or how many tokens were consumed.

`ai-stream-monitor` is purpose-built for this. It provides:

- **Full streaming lifecycle** — TTFT (time to first token), TTLB (time to last byte), TPS (tokens per second), stall detection
- **Phase-level breakdown** — separate timing for thinking, generating, and tool-calling phases
- **Tool call chains** — track each tool invocation with name, params, result, and duration
- **Auto-parsing** — built-in parsers for OpenAI and Anthropic stream formats that detect phases and token usage automatically
- **Tiny footprint** — full bundle ~12 KB gzipped, individual plugins 0.4–1.5 KB each, every plugin is a separate entry point for tree-shaking

## Requirements

- **Runtime**: Browser (ES2020+) or Node.js 16+
- **React integration** (optional): React 17+
- **No runtime dependencies**

## Installation

```bash
npm install ai-stream-monitor
```

## Quick Start

### Zero-config setup

```typescript
import { createAIChatMonitor } from 'ai-stream-monitor'

const monitor = createAIChatMonitor({ appId: 'my-ai-app' })
```

This single line enables error tracking, session management, and stream tracing. Events are sent via `POST /api/monitor` by default.

### React setup

Wrap your app in `MonitorProvider`. All child components can then access the monitor via hooks.

```tsx
import { MonitorProvider } from 'ai-stream-monitor/react'

function App() {
  return (
    <MonitorProvider config={{ appId: 'my-ai-app' }}>
      <ChatApp />
    </MonitorProvider>
  )
}
```

## Stream Tracing

Stream tracing is the core feature. It tracks the full lifecycle of a single AI streaming response, from the moment you send the request to the final token.

### Manual tracing

Use `createStreamTrace` to create a trace, then call lifecycle methods as the stream progresses:

```typescript
const trace = monitor.createStreamTrace({
  messageId: 'msg_123',
  model: 'gpt-4o',
  stallThreshold: 5000,
})

trace.start()
trace.onFirstChunk()
trace.onPhase('thinking', 'start')
trace.onPhase('thinking', 'end')
trace.onPhase('generating', 'start')
trace.onToolCall('web_search', { query: 'latest news' })
trace.onToolResult('web_search', { ok: true })
trace.complete({ completionTokens: 350, model: 'gpt-4o' })
```

Each call emits a typed event (`stream_start`, `stream_first_token`, `stream_phase`, etc.) with timing data attached.

### Automatic stream parsing

Instead of calling lifecycle methods manually, configure a `parser` and `streamPatterns`. The SDK will intercept matching fetch requests, read the SSE stream, and drive the trace automatically:

```typescript
const monitor = createAIChatMonitor({
  appId: 'my-ai-app',
  fetch: { streamPatterns: [/\/api\/chat/, /\/v1\/completions/] },
  parser: 'openai',
})
```

Supported parsers:

- `'openai'` — OpenAI, DeepSeek, Volcengine, and any OpenAI-compatible format
- `'anthropic'` — Anthropic Claude event stream format
- `'auto'` — detects the format from the first line of the stream
- Custom `ChunkParser` instance — implement `parse(raw: string)` and `reset()` for other providers

**Token usage**: When the API returns token counts in the stream (OpenAI requires `stream_options: { include_usage: true }`, Anthropic includes it by default), the SDK reports exact values. Otherwise, it estimates `completionTokens` by counting content chunks and marks the result with `estimatedTokens: true`.

### React hook

```tsx
import { useStreamTrace } from 'ai-stream-monitor/react'

function ChatMessage({ messageId }: { messageId: string }) {
  const { startTrace } = useStreamTrace({ messageId })

  const handleSend = async () => {
    const trace = startTrace()
    trace.start()

    const response = await fetch('/api/chat', { method: 'POST', body: '...' })
    const reader = response.body!.getReader()
    let isFirst = true

    while (true) {
      const { done, value } = await reader.read()
      if (done) { trace.complete(); break }
      if (isFirst) { trace.onFirstChunk(); isFirst = false }
    }
  }

  return <button onClick={handleSend}>Send</button>
}
```

## Configuration

### Presets

`createAIChatMonitor` ships with three presets that bundle common plugin combinations:

**development** (default when `NODE_ENV !== 'production'`):
- 100% sampling, debug logging on, immediate event send
- Plugins: Error, Session, Fetch, Sampling, Dedupe, Transport, Performance

**production** (default when `NODE_ENV === 'production'`):
- 10% sampling, batch send (10 events / 5s flush), deduplication
- Plugins: all development plugins + OfflineQueue (IndexedDB persistence)

**minimal**:
- 5% sampling, errors only, no fetch interception
- Plugins: Error, Session, Sampling, Transport

```typescript
createAIChatMonitor({ appId: 'my-app', preset: 'production' })
```

### Full configuration reference

```typescript
createAIChatMonitor({
  // --- Required ---
  appId: 'my-ai-app',

  // --- General ---
  endpoint: '/api/telemetry',   // event receiver URL (default: '/api/monitor')
  debug: false,                 // console logging for SDK internals
  version: '1.0.0',            // app version, attached to every event context
  preset: 'production',        // 'development' | 'production' | 'minimal'

  // --- Transport ---
  transport: {
    mode: 'batch',              // 'immediate' | 'batch'
    batchSize: 10,              // flush after N events (batch mode)
    flushInterval: 5000,        // flush interval in ms (batch mode)
    maxRetries: 3,              // retry failed sends with exponential backoff (max 30s)
    headers: {                  // custom headers for fetch transport (not used by sendBeacon)
      'X-Auth-Token': 'your-token',
    },
  },

  // --- Sampling ---
  sampling: {
    rate: 0.1,                                          // sample 10% of sessions
    alwaysSample: ['js_error', 'promise_error', 'stream_error'],  // never drop these
  },

  // --- Error tracking ---
  error: {
    ignoreErrors: [/ResizeObserver/],     // skip errors matching these patterns
    ignoreUrls: [/chrome-extension/],     // skip errors from these script URLs
  },

  // --- Fetch interception ---
  fetch: {
    streamPatterns: [/\/api\/chat/],      // URLs matching these are auto-traced as AI streams
    excludeUrls: [/\/health/],            // never intercept these URLs
  },

  // --- Stream parser ---
  parser: 'openai',           // auto-detect thinking phases, tool calls, token usage

  // --- Deduplication ---
  dedupeWindow: 5000,         // suppress identical events within this window (ms)

  // --- Event hook ---
  beforeSend: (event) => {
    // mutate, filter, or enrich events before they reach the transport
    // return null to drop the event
    return event
  },
})
```

### Manual plugin assembly

For full control, use the `Monitor` class directly and register only the plugins you need:

```typescript
import { Monitor } from 'ai-stream-monitor'
import { ErrorPlugin } from 'ai-stream-monitor/plugins/error'
import { TransportPlugin } from 'ai-stream-monitor/plugins/transport'
import { FetchPlugin } from 'ai-stream-monitor/plugins/fetch'

const monitor = new Monitor({ appId: 'my-app', debug: true })

monitor.use(new ErrorPlugin({ ignoreErrors: [/ResizeObserver/] }))
monitor.use(new FetchPlugin({ streamPatterns: [/\/api\/chat/], parser: 'openai' }))
monitor.use(new TransportPlugin({ endpoint: '/api/monitor', mode: 'batch' }))
monitor.init()
```

Plugins execute in priority order (lower number = earlier). The event pipeline is: emit → SamplingPlugin → DedupePlugin → SessionPlugin → ... → TransportPlugin.

## Plugins

Each plugin is published as a separate entry point for tree-shaking. Import from `ai-stream-monitor/plugins/<name>`.

### SamplingPlugin (priority 10)

Session-level sampling. When a session is not sampled, all events are dropped except those listed in `alwaysSample`. Sampling decision is made once per session and persisted.

### DedupePlugin (priority 20)

Suppresses duplicate events of the same type with identical data fingerprints within a configurable time window (default 5000ms).

### SessionPlugin (priority 30)

Manages a `sessionId` stored in `sessionStorage` (with in-memory fallback). Emits `session_start` and `session_end` events. Session ID is generated using crypto-secure randomness with `Math.random` fallback.

### ErrorPlugin (priority 50)

Captures `window.onerror` (JS errors) and `unhandledrejection` (promise rejections). In Node.js, listens to `process.on('uncaughtException')` and `process.on('unhandledRejection')`. Supports pattern-based filtering via `ignoreErrors` and `ignoreUrls`.

### FetchPlugin (priority 50)

Intercepts `globalThis.fetch` to track HTTP requests. When a response matches `streamPatterns` and returns a streaming content type (`text/event-stream`, `application/stream+json`, `application/x-ndjson`), automatically creates a `StreamTrace` and reads the stream. If a `parser` is configured, the stream content is parsed to detect phases, tool calls, and token usage.

### PerformancePlugin (priority 50)

Collects Web Vitals using the `PerformanceObserver` API: FCP, LCP, CLS, and INP. Each metric is emitted as a `web_vital` event.

### SSEAutoPlugin (priority 50)

Intercepts `new EventSource(url)` to automatically trace Server-Sent Event connections. Only traces URLs matching `includeUrls` (no URLs are traced when `includeUrls` is not configured).

### WebSocketPlugin (priority 50)

Intercepts `new WebSocket(url)` to trace WebSocket message streams. Only traces URLs matching `includeUrls` (no URLs are traced when `includeUrls` is not configured).

### TransportPlugin (priority 90)

Sends events to your backend endpoint. Uses `navigator.sendBeacon` for reliability (survives page unload), with automatic fallback to `fetch` when the payload exceeds 60 KB or custom headers are configured. Supports `immediate` and `batch` modes. Failed sends are retried with exponential backoff capped at 30 seconds.

### OfflineQueuePlugin (priority 95)

Persists unsent events in IndexedDB when the network is unavailable. Automatically flushes the queue when connectivity is restored. Supports `maxSize` (max events in queue) and `maxAge` (auto-purge expired events).

## Event Types Reference

Every event has a `type` string and a `data` object. Below is what each type contains.

### Error events

**`js_error`** — JavaScript runtime error

`data`: `{ message, stack, filename, lineno, colno }`

**`promise_error`** — Unhandled promise rejection

`data`: `{ message, stack, reason }`

### HTTP events

**`http_request`** — Fetch request completed

`data`: `{ method, url, status, duration, ok }`

### Performance events

**`web_vital`** — Web Vitals metric

`data`: `{ name, value, rating }` where `name` is one of `FCP`, `LCP`, `CLS`, `INP`

### Stream lifecycle events

**`stream_start`** — Stream trace started

`data`: `{ traceId, messageId, model, provider }`

**`stream_first_token`** — First token received

`data`: `{ traceId, messageId, ttft }` where `ttft` is time-to-first-token in ms

**`stream_phase`** — Thinking/generating phase boundary

`data`: `{ traceId, messageId, phase, action, duration }` where `action` is `'start'` or `'end'`

**`stream_tool_call`** — Tool call lifecycle

`data`: `{ traceId, messageId, toolName, params, result, duration }`

**`stream_stall`** — Stream stall detected (no data received for longer than `stallThreshold`)

`data`: `{ traceId, messageId, stallDuration }`

**`stream_complete`** — Stream finished successfully

`data`: `{ traceId, messageId, ttfb, ttlb, tps, promptTokens, completionTokens, totalTokens, estimatedTokens, phases }`

When the API response includes token usage (e.g. OpenAI with `stream_options: { include_usage: true }`), `promptTokens` / `completionTokens` / `totalTokens` are exact values from the API. When token usage is not available, the SDK estimates `completionTokens` by counting content chunks in the stream (each SSE event typically equals one token). In this case `estimatedTokens` is set to `true` so your backend can distinguish exact counts from estimates.

**`stream_error`** — Stream failed

`data`: `{ traceId, messageId, error }`

### Session events

**`session_start`** — New session started

`data`: `{ sessionId }`

**`session_end`** — Session ended (page unload)

`data`: `{ sessionId, duration }`

### Custom events

**`custom`** — User-defined event via `monitor.emit(monitor.createEvent('custom', { ... }))`

## Event Schema

Every event follows this structure:

```typescript
interface MonitorEvent {
  id: string                    // unique event ID
  type: MonitorEventType        // event type (see above)
  timestamp: number             // Unix timestamp in ms
  data: Record<string, unknown> // event-specific payload
  context: {
    appId: string               // your application ID
    sessionId: string           // auto-generated session ID
    userId?: string             // set via monitor.setContext({ userId })
    url: string                 // current page URL
    userAgent: string           // browser user agent
    version?: string            // app version from config
  }
}
```

## Backend Integration

The SDK sends `MonitorEvent[]` as a JSON array to your configured endpoint. A minimal Express receiver:

```typescript
app.post('/api/monitor', (req, res) => {
  const events: MonitorEvent[] = req.body

  for (const event of events) {
    switch (event.type) {
      case 'stream_complete':
        console.log(`TTFT: ${event.data.ttft}ms, TPS: ${event.data.tps}`)
        break
      case 'js_error':
        console.error(`Error: ${event.data.message}`)
        break
    }
  }

  res.json({ ok: true })
})
```

## Grafana / Prometheus Integration

The [examples/](https://github.com/Erica-cod/ai_chat_monitor_sdk/tree/main/examples) directory on GitHub includes a production-ready Prometheus backend and a Grafana dashboard:

- **[backend-prometheus.ts](https://github.com/Erica-cod/ai_chat_monitor_sdk/blob/main/examples/backend-prometheus.ts)** — Express server that converts SDK events into Prometheus metrics. Covers all event types with `app_id`, `model`, and `provider` labels.
- **[grafana-dashboard.json](https://github.com/Erica-cod/ai_chat_monitor_sdk/blob/main/examples/grafana-dashboard.json)** — importable Grafana dashboard with TTFT/TTLB/TPS percentile charts, token usage breakdown, error rates, Web Vitals, and active stream gauges. Uses a `$app_id` template variable for multi-app filtering.

Quick setup:

```bash
cd examples
npm install express prom-client
npx ts-node backend-prometheus.ts
```

Then configure your Prometheus to scrape `http://localhost:3001/metrics` and import the dashboard JSON into Grafana.

The SDK itself is transport-agnostic — it only produces JSON events. If you use a different observability stack (Loki, ClickHouse, OpenTelemetry, Datadog), use the event schema documented above to build your own adapter. The Prometheus example serves as a reference implementation.

## Design Principles

1. **Zero config** — one import, one function call. Sensible defaults for everything.
2. **Never crash the host app** — every plugin runs inside try-catch. SDK bugs are swallowed (and logged in debug mode), never thrown.
3. **Tree-shakeable** — each plugin is a separate entry point. Import only what you need.
4. **Framework agnostic** — vanilla JavaScript core. React hooks are an optional add-on.
5. **Transport agnostic** — the SDK emits JSON events. You decide where they go.

## Bundle Size

Measured gzip sizes of ESM builds:

| Import path | Raw | Gzip |
|---|---|---|
| `ai-stream-monitor` (full bundle) | 53.4 KB | ~12 KB |
| `ai-stream-monitor/react` | 49.2 KB | ~12 KB |
| `ai-stream-monitor/plugins/error` | 3.8 KB | ~0.9 KB |
| `ai-stream-monitor/plugins/transport` | 3.7 KB | ~1.2 KB |
| `ai-stream-monitor/plugins/fetch` | 16.4 KB | ~4.4 KB |
| `ai-stream-monitor/plugins/session` | 3.2 KB | ~0.9 KB |
| `ai-stream-monitor/plugins/sampling` | 0.8 KB | ~0.4 KB |
| `ai-stream-monitor/plugins/dedupe` | 1.4 KB | ~0.6 KB |
| `ai-stream-monitor/parsers` | 8.0 KB | ~2.0 KB |

When using manual plugin assembly (instead of the full preset), you import only the plugins you need. For example, `Monitor` + `ErrorPlugin` + `TransportPlugin` together gzip to roughly 3 KB.

## License

MIT
