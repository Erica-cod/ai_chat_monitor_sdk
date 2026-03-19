# ai-stream-monitor

Lightweight frontend monitoring SDK for AI chat applications. Core gzip < 3KB.

## Why?

Traditional monitoring SDKs (Sentry, LogRocket) are designed for generic web apps. They don't understand streaming lifecycle, AI conversation phases, or tool calling chains. `ai-stream-monitor` fills this gap.

| Pain Point | Traditional SDKs | ai-stream-monitor |
|---|---|---|
| Streaming | Only tracks request start/end | Full lifecycle: TTFT, TTLB, phases, stall detection |
| AI tool calling | Not tracked | Tool call chains with timing |
| Thinking/generating phases | Not tracked | Phase-level breakdown |
| Bundle size | 22-68KB+ | Core < 3KB, tree-shakeable |
| AI-specific retries | Lost correlation | traceId links retry chains |

## Quick Start

```bash
npm install ai-stream-monitor
```

### One-line setup (zero config)

```typescript
import { createAIChatMonitor } from 'ai-stream-monitor'

const monitor = createAIChatMonitor({ appId: 'my-ai-app' })
```

That's it. Error tracking, performance metrics, and stream tracing are enabled by default. Data is sent to `POST /api/monitor`.

### With React

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

## Stream Trace — The Core Feature

Track the full lifecycle of an AI streaming response:

```typescript
const trace = monitor.createStreamTrace({
  messageId: 'msg_123',
  model: 'gpt-4o',
  stallThreshold: 5000,   // detect stalls > 5s
})

trace.start()                              // Request sent
trace.onFirstChunk()                       // First byte → TTFT
trace.onPhase('thinking', 'start')         // AI thinking phase
trace.onPhase('thinking', 'end')
trace.onPhase('generating', 'start')       // AI generating phase
trace.onToolCall('web_search', { query })  // Tool call started
trace.onToolResult('web_search', { ok })   // Tool call completed
trace.complete({ completionTokens: 350, model: 'gpt-4o' })  // Stream done → TTLB, TPS
```

### Auto-parse streaming content

```typescript
const monitor = createAIChatMonitor({
  appId: 'my-ai-app',
  fetch: { streamPatterns: [/\/api\/chat/, /\/v1\/completions/] },
  parser: 'openai',  // or 'anthropic', 'auto'
})
```

With `parser` configured, the SDK automatically detects thinking phases, tool calls, and token usage from the stream — no manual `trace.onPhase()` calls needed.

### With React Hook

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

```typescript
// Auto-detected: development mode (NODE_ENV) → debug on, 100% sampling, immediate send
createAIChatMonitor({ appId: 'my-app' })

// Explicit production preset → 10% sampling, batch send, dedupe, Web Vitals, offline queue
createAIChatMonitor({ appId: 'my-app', preset: 'production' })

// Minimal → errors only, 5% sampling
createAIChatMonitor({ appId: 'my-app', preset: 'minimal' })
```

### Full Configuration

```typescript
createAIChatMonitor({
  appId: 'my-ai-app',
  endpoint: '/api/telemetry',
  debug: false,
  version: '1.0.0',

  preset: 'production',

  transport: {
    mode: 'batch',
    batchSize: 10,
    flushInterval: 5000,
    maxRetries: 3,
    headers: { 'X-Auth-Token': 'your-token' },
  },

  sampling: {
    rate: 0.1,
    alwaysSample: ['js_error', 'promise_error', 'stream_error'],
  },

  error: {
    ignoreErrors: [/ResizeObserver/],
    ignoreUrls: [/chrome-extension/],
  },

  fetch: {
    streamPatterns: [/\/api\/chat/],
    excludeUrls: [/\/health/],
  },

  parser: 'openai',
  dedupeWindow: 5000,

  beforeSend: (event) => {
    // data masking, filtering, enrichment
    return event
  },
})
```

### Manual Plugin Registration

For fine-grained control:

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

## Plugins

| Plugin | Priority | Description |
|---|---|---|
| `SamplingPlugin` | 10 | Session-based sampling with per-type rates |
| `DedupePlugin` | 20 | Deduplicates events within a time window |
| `SessionPlugin` | 30 | Session ID management (sessionStorage + memory fallback) |
| `ErrorPlugin` | 50 | JS errors, promise rejections (browser + Node.js) |
| `FetchPlugin` | 50 | HTTP request interception, auto stream tracing |
| `PerformancePlugin` | 50 | Web Vitals (FCP, LCP, CLS, INP) |
| `SSEAutoPlugin` | 50 | Auto-trace native EventSource connections |
| `WebSocketPlugin` | 50 | Auto-trace WebSocket connections |
| `TransportPlugin` | 90 | sendBeacon + fetch fallback, batch/immediate |
| `OfflineQueuePlugin` | 95 | IndexedDB offline queue with retry |

## Event Types

```typescript
type MonitorEventType =
  | 'js_error'              // JavaScript runtime error
  | 'promise_error'         // Unhandled promise rejection
  | 'http_request'          // Fetch request (method, status, duration)
  | 'web_vital'             // FCP, LCP, CLS, INP
  | 'stream_start'          // Stream started
  | 'stream_first_token'    // First token received (TTFT)
  | 'stream_phase'          // Thinking/generating phase timing
  | 'stream_tool_call'      // Tool calling lifecycle
  | 'stream_stall'          // Stream stall detected
  | 'stream_complete'       // Stream completed (TTLB, TPS)
  | 'stream_error'          // Stream error
  | 'session_start'         // Session started
  | 'session_end'           // Session ended
  | 'custom'                // User-defined events
```

## Backend Receiver

The SDK sends `MonitorEvent[]` as JSON to your endpoint. Here's a minimal receiver:

```typescript
// Express
app.post('/api/monitor', (req, res) => {
  const events = req.body  // MonitorEvent[]
  for (const event of events) {
    console.log(`[${event.type}]`, event.data)
  }
  res.json({ ok: true })
})
```

See `examples/` for Prometheus integration examples.

## Event Schema

```typescript
interface MonitorEvent {
  id: string
  type: MonitorEventType
  timestamp: number
  data: Record<string, unknown>
  context: {
    appId: string
    sessionId: string
    userId?: string
    url: string
    userAgent: string
    version?: string
  }
}
```

## Design Principles

1. **Zero config** — one line to start, sensible defaults for everything
2. **Never crash host app** — all plugin execution is try-catch wrapped
3. **Tree-shakeable** — import only what you need
4. **Framework agnostic** — vanilla JS core, optional React hooks
5. **Transport agnostic** — SDK sends JSON, you decide where it goes

## Bundle Size

| Import | Gzip |
|---|---|
| `createAIChatMonitor` (full preset) | ~3 KB |
| `Monitor` + `ErrorPlugin` + `TransportPlugin` | ~1.5 KB |
| `ai-stream-monitor/react` | ~0.5 KB |

## License

MIT
