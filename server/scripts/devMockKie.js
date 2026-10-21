#!/usr/bin/env node
// Development-only stand-in for the Kie.ai API, for clicking through the app
// without a real key or credits. It serves striped grey placeholder PNGs,
// never real generations.
//
//   DEV_MOCK_KIE_PORT=5055 DEV_MOCK_KIE_KEY=<any 16+ char test key> node scripts/devMockKie.js
//
// Then start the API with KIE_API_BASE_URL and KIE_UPLOAD_BASE_URL set to
// http://127.0.0.1:5055 (loopback http is accepted outside production only).
import http from 'node:http';
import { startMockKie } from '../tests/fixtures/mockKie.js';

const port = Number(process.env.DEV_MOCK_KIE_PORT || 5055);
const key = process.env.DEV_MOCK_KIE_KEY;
if (!key || key.length < 16) {
  console.error('Set DEV_MOCK_KIE_KEY to the test key you will paste in API Settings (16+ characters).');
  process.exit(1);
}

const mock = await startMockKie();
mock.state.validKeys = new Set([key]);
mock.state.credits = 250;
// Slow the fake generation down a little so the progress states are visible.
mock.state.sequence = ['waiting', 'waiting', 'generating', 'generating', 'generating', 'success'];

// Re-expose the mock on a fixed port, rewriting result URLs to that port.
const target = new URL(mock.url);
const proxy = http.createServer((req, res) => {
  const upstream = http.request({ host: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers }, (answer) => {
    const chunks = [];
    answer.on('data', (chunk) => chunks.push(chunk));
    answer.on('end', () => {
      let body = Buffer.concat(chunks);
      if (String(answer.headers['content-type'] || '').includes('application/json')) {
        body = Buffer.from(body.toString('utf8').replaceAll(mock.url, `http://127.0.0.1:${port}`));
      }
      const headers = { ...answer.headers, 'content-length': body.length };
      delete headers['transfer-encoding'];
      res.writeHead(answer.statusCode, headers);
      res.end(body);
    });
  });
  upstream.on('error', () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
proxy.listen(port, '127.0.0.1', () => console.log(`Mock Kie.ai (placeholders only) on http://127.0.0.1:${port}`));
