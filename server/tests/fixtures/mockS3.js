// A minimal local S3-compatible server (path-style) so the real AWS SDK and the
// S3 storage driver can be exercised over HTTP without touching any real
// bucket. Implements HeadBucket, ListObjectsV2 (prefix/delimiter), PutObject,
// GetObject, HeadObject and DeleteObject. Signatures are not verified; the
// test only checks that a signed Authorization header is sent.
import http from 'node:http';
import crypto from 'node:crypto';

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

function errorXml(code, message) {
  return `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(message)}</Message></Error>`;
}

export async function startMockS3({ bucket = 'infographic-test' } = {}) {
  const state = {
    bucket,
    objects: new Map(), // key -> { body, contentType, cacheControl, etag, modified }
    down: false,
    calls: { put: 0, get: 0, head: 0, delete: 0, list: 0, headBucket: 0 },
    unsigned: 0,
  };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const [, bucketName, ...rest] = url.pathname.split('/');
      const key = decodeURIComponent(rest.join('/'));
      if (!/^AWS4-HMAC-SHA256 /.test(req.headers.authorization || '')) state.unsigned += 1;

      const fail = (status, code, message) => {
        res.writeHead(status, { 'Content-Type': 'application/xml' });
        res.end(req.method === 'HEAD' ? undefined : errorXml(code, message));
      };
      if (state.down) return fail(503, 'ServiceUnavailable', 'Mock outage');
      if (bucketName !== state.bucket) return fail(404, 'NoSuchBucket', 'The specified bucket does not exist');

      if (!key) {
        if (req.method === 'HEAD') {
          state.calls.headBucket += 1;
          res.writeHead(200);
          return res.end();
        }
        if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
          state.calls.list += 1;
          const prefix = url.searchParams.get('prefix') || '';
          const delimiter = url.searchParams.get('delimiter') || '';
          const max = Number(url.searchParams.get('max-keys') || 1000);
          const contents = [];
          const folders = new Set();
          for (const [name, object] of [...state.objects.entries()].sort()) {
            if (!name.startsWith(prefix)) continue;
            const restOfKey = name.slice(prefix.length);
            const cut = delimiter ? restOfKey.indexOf(delimiter) : -1;
            if (cut >= 0) folders.add(prefix + restOfKey.slice(0, cut + delimiter.length));
            else contents.push([name, object]);
          }
          const shown = contents.slice(0, max);
          const body = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
            `<Name>${xmlEscape(state.bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><MaxKeys>${max}</MaxKeys>`,
            delimiter ? `<Delimiter>${xmlEscape(delimiter)}</Delimiter>` : '',
            `<KeyCount>${shown.length + folders.size}</KeyCount><IsTruncated>false</IsTruncated>`,
            ...shown.map(
              ([name, object]) =>
                `<Contents><Key>${xmlEscape(name)}</Key><LastModified>${object.modified.toISOString()}</LastModified><ETag>"${object.etag}"</ETag><Size>${object.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`,
            ),
            ...[...folders].map((folder) => `<CommonPrefixes><Prefix>${xmlEscape(folder)}</Prefix></CommonPrefixes>`),
            '</ListBucketResult>',
          ].join('');
          res.writeHead(200, { 'Content-Type': 'application/xml' });
          return res.end(body);
        }
        return fail(400, 'InvalidRequest', 'Unsupported bucket operation');
      }

      if (req.method === 'PUT') {
        state.calls.put += 1;
        const body = Buffer.concat(chunks);
        const etag = crypto.createHash('md5').update(body).digest('hex');
        state.objects.set(key, {
          body,
          contentType: req.headers['content-type'] || 'application/octet-stream',
          cacheControl: req.headers['cache-control'] || null,
          acl: req.headers['x-amz-acl'] || null,
          etag,
          modified: new Date(),
        });
        res.writeHead(200, { ETag: `"${etag}"` });
        return res.end();
      }
      const object = state.objects.get(key);
      if (req.method === 'GET' || req.method === 'HEAD') {
        state.calls[req.method === 'GET' ? 'get' : 'head'] += 1;
        if (!object) return fail(404, 'NoSuchKey', 'The specified key does not exist.');
        res.writeHead(200, {
          'Content-Type': object.contentType,
          'Content-Length': object.body.length,
          ETag: `"${object.etag}"`,
          'Last-Modified': object.modified.toUTCString(),
        });
        return res.end(req.method === 'GET' ? object.body : undefined);
      }
      if (req.method === 'DELETE') {
        state.calls.delete += 1;
        state.objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      return fail(405, 'MethodNotAllowed', 'Unsupported');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    stop: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
