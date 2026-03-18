/**
 * 最简后端接收示例 — Express
 *
 * npm install express
 * npx ts-node examples/backend-express.ts
 */
import express from 'express';

const app = express();
app.use(express.json({ limit: '1mb' }));

// SDK 上报的数据会 POST 到这个端点
app.post('/api/monitor', (req, res) => {
  const events = req.body; // MonitorEvent[]

  // 你可以存到任何地方：数据库、日志文件、消息队列...
  for (const event of events) {
    console.log(`[${event.type}] ${JSON.stringify(event.data)}`);
  }

  res.json({ ok: true });
});

app.listen(3001, () => {
  console.log('Monitor receiver listening on http://localhost:3001');
});
