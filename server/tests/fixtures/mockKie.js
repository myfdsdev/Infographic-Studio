// A local stand-in for the Kie.ai API, implementing the documented contract
// (docs.kie.ai): HTTP 200 with the real status in body `code`, createTask ->
// data.taskId, recordInfo -> state/resultJson/param/failMsg, chat/credit ->
// balance, file-stream-upload -> data.downloadUrl, common/download-url ->
// data (a fresh link). Result files are real bytes served by this server and
// clearly placeholders (striped grey PNGs). Never presented as real generations.
// Lets tests exercise every failure mode without spending credits.
import http from 'node:http';
import { makePng } from './images.js';

const RESULT_PNG = makePng(384, 512, { shade: 70 });


function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  const parts = {};
  let start = buffer.indexOf(boundary);
  while (start !== -1) {
    const next = buffer.indexOf(boundary, start + boundary.length);
    if (next === -1) break;
    const part = buffer.subarray(start + boundary.length + 2, next - 2); // skip CRLF after boundary and before next
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const headers = part.subarray(0, split).toString('utf8');
      const body = part.subarray(split + 4);
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      const type = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
      if (name) parts[name] = filename !== undefined ? { filename, type, data: Buffer.from(body) } : body.toString('utf8');
    }
    start = next;
  }
  return parts;
}

export async function startMockKie() {
  const state = {
    validKeys: new Set(),
    credits: 100,
    creditMode: 'ok', // ok | maintenance | html
    createMode: 'ok', // ok | rate_limited | insufficient | invalid | server_error | unauthorized | hang | html_502 | no_task_id
    createQueue: [], // per-call overrides, consumed first
    hangMs: 1000,
    sequence: ['waiting', 'generating', 'success'],
    failMessage: null,
    modelSequences: {}, // model id -> state sequence override (e.g. make one step fail)
    brokenModels: new Set(), // models whose result file is garbage
    uploadMode: 'ok', // ok | unauthorized | server_error
    uploadQueue: [],
    fileMode: 'ok', // ok | forbidden (direct link refused, fresh link works) | not_image | gone
    tasks: new Map(),
    uploads: [],
    calls: { credit: 0, create: 0, record: 0, upload: 0, downloadUrl: 0, file: 0 },
    authHeaders: [],
    counter: 0,
  };

  function reset() {
    state.validKeys = new Set();
    state.credits = 100;
    state.creditMode = 'ok';
    state.createMode = 'ok';
    state.createQueue = [];
    state.sequence = ['waiting', 'generating', 'success'];
    state.failMessage = null;
    state.modelSequences = {};
    state.brokenModels = new Set();
    state.uploadMode = 'ok';
    state.uploadQueue = [];
    state.fileMode = 'ok';
    state.tasks = new Map();
    state.uploads = [];
    state.calls = { credit: 0, create: 0, record: 0, upload: 0, downloadUrl: 0, file: 0 };
    state.authHeaders = [];
  }

  let baseUrl = '';

  function send(res, body, status = 200) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  function keyOf(req) {
    const header = req.headers.authorization || '';
    if (header) state.authHeaders.push(header);
    return header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  function makeTask(apiKey, body) {
    state.counter += 1;
    const taskId = `task_mock_${state.counter}`;
    state.tasks.set(taskId, {
      taskId,
      apiKey,
      model: body.model,
      input: body.input,
      callBackUrl: body.callBackUrl || null,
      polls: 0,
      sequence: [...(state.modelSequences[body.model] || state.sequence)],
      failMessage: state.failMessage,
    });
    return taskId;
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const rawBuffer = Buffer.concat(chunks);
      const raw = rawBuffer.toString('utf8');
      const url = new URL(req.url, 'http://127.0.0.1');

      // ---- public files (no auth, like a CDN)
      if (req.method === 'GET' && url.pathname.startsWith('/files/')) {
        state.calls.file += 1;
        const signed = url.searchParams.get('signed') === '1';
        if (state.fileMode === 'gone') return send(res, { error: 'gone' }, 404);
        if (state.fileMode === 'forbidden' && !signed) return send(res, { error: 'forbidden' }, 403);
        const taskId = decodeURIComponent(url.pathname.slice('/files/'.length)).replace(/\.[a-z0-9]+$/, '');
        const task = state.tasks.get(taskId);
        if (state.fileMode === 'not_image' || (task && state.brokenModels.has(task.model))) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end('<html>not an image</html>');
        }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': RESULT_PNG.length });
        return res.end(RESULT_PNG);
      }
      if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
        const id = Number(url.pathname.split('/')[2]);
        const upload = state.uploads[id];
        if (!upload) return send(res, { error: 'not found' }, 404);
        res.writeHead(200, { 'Content-Type': upload.mimeType || 'application/octet-stream' });
        return res.end(upload.data);
      }

      const apiKey = keyOf(req);
      const authorized = state.validKeys.has(apiKey);

      if (req.method === 'GET' && url.pathname === '/api/v1/chat/credit') {
        state.calls.credit += 1;
        if (state.creditMode === 'maintenance') return send(res, { code: 455, msg: 'Service under maintenance' });
        if (state.creditMode === 'html') {
          res.writeHead(502, { 'Content-Type': 'text/html' });
          return res.end('<html>Bad gateway</html>');
        }
        if (!authorized) return send(res, { code: 401, msg: 'Unauthorized' });
        return send(res, { code: 200, msg: 'success', data: state.credits });
      }

      if (req.method === 'POST' && url.pathname === '/api/file-stream-upload') {
        state.calls.upload += 1;
        const mode = state.uploadQueue.length ? state.uploadQueue.shift() : state.uploadMode;
        if (!authorized || mode === 'unauthorized') return send(res, { success: false, code: 401, msg: 'Unauthorized' });
        if (mode === 'server_error') return send(res, { success: false, code: 500, msg: 'Upload failed' });
        const form = parseMultipart(rawBuffer, req.headers['content-type']);
        if (!form?.file?.data?.length || !form.uploadPath) return send(res, { success: false, code: 400, msg: 'file and uploadPath are required' });
        const id = state.uploads.length;
        const fileName = form.fileName || form.file.filename || `file-${id}`;
        state.uploads.push({ apiKey, fileName, uploadPath: form.uploadPath, mimeType: form.file.type, data: form.file.data });
        return send(res, {
          success: true,
          code: 200,
          msg: 'File uploaded successfully',
          data: {
            fileName,
            filePath: `${form.uploadPath}/${fileName}`,
            downloadUrl: `${baseUrl}/uploads/${id}/${encodeURIComponent(fileName)}`,
            fileSize: form.file.data.length,
            mimeType: form.file.type,
            uploadedAt: new Date().toISOString(),
          },
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/common/download-url') {
        state.calls.downloadUrl += 1;
        if (!authorized) return send(res, { code: 401, msg: 'Unauthorized' });
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return send(res, { code: 422, msg: 'Invalid JSON' });
        }
        if (!String(body.url || '').startsWith(`${baseUrl}/files/`)) return send(res, { code: 422, msg: 'Only files generated by kie.ai are supported' });
        return send(res, { code: 200, msg: 'success', data: `${body.url}?signed=1` });
      }

      if (req.method === 'POST' && url.pathname === '/api/v1/jobs/createTask') {
        state.calls.create += 1;
        if (!authorized) return send(res, { code: 401, msg: 'Unauthorized' });
        let body = {};
        try {
          body = JSON.parse(raw || '{}');
        } catch {
          return send(res, { code: 422, msg: 'Invalid JSON' });
        }
        const mode = state.createQueue.length ? state.createQueue.shift() : state.createMode;
        switch (mode) {
          case 'rate_limited':
            return send(res, { code: 429, msg: 'Rate limit exceeded' });
          case 'insufficient':
            return send(res, { code: 402, msg: 'Insufficient credits' });
          case 'invalid':
            return send(res, { code: 422, msg: 'aspect_ratio is invalid' });
          case 'server_error':
            return send(res, { code: 500, msg: 'Internal error' });
          case 'unauthorized':
            return send(res, { code: 401, msg: 'Unauthorized' });
          case 'html_502': {
            res.writeHead(502, { 'Content-Type': 'text/html' });
            return res.end('<html>Bad gateway</html>');
          }
          case 'no_task_id':
            return send(res, { code: 200, msg: 'success', data: {} });
          case 'hang': {
            // The provider DID create the task, but the answer never arrives in time.
            const taskId = makeTask(apiKey, body);
            setTimeout(() => send(res, { code: 200, msg: 'success', data: { taskId } }), state.hangMs);
            return undefined;
          }
          default: {
            const taskId = makeTask(apiKey, body);
            return send(res, { code: 200, msg: 'success', data: { taskId } });
          }
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/v1/jobs/recordInfo') {
        state.calls.record += 1;
        if (!authorized) return send(res, { code: 401, msg: 'Unauthorized' });
        const task = state.tasks.get(url.searchParams.get('taskId') || '');
        if (!task || task.apiKey !== apiKey) return send(res, { code: 422, msg: 'Task not found' });
        task.polls += 1;
        const current = task.sequence[Math.min(task.polls - 1, task.sequence.length - 1)];
        const success = current === 'success';
        const failed = current === 'fail';
        return send(res, {
          code: 200,
          msg: 'success',
          data: {
            taskId: task.taskId,
            model: task.model,
            state: current,
            param: JSON.stringify({ model: task.model, callBackUrl: task.callBackUrl, input: JSON.stringify(task.input) }),
            resultJson: success ? JSON.stringify({ resultUrls: [`${baseUrl}/files/${task.taskId}.png`] }) : '',
            failCode: failed ? '500' : null,
            failMsg: failed ? task.failMessage || 'Content policy violation' : null,
            costTime: success || failed ? 12 : null,
            creditsConsumed: success ? 4 : failed ? 0 : null,
            createTime: Date.now(),
          },
        });
      }

      return send(res, { code: 404, msg: 'Not found' });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
  return {
    url: baseUrl,
    state,
    reset,
    resultPng: RESULT_PNG,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
