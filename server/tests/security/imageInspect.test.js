// Upload safety: real file type from bytes, dimensions, metadata removal,
// and private-address detection for downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePng, makeJpeg } from '../fixtures/images.js';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/unused';
process.env.SESSION_SECRET = 'test-only-session-secret-0123456789abcdef';
process.env.ENCRYPTION_KEY = 'c'.repeat(64);
process.env.EMAIL_PROVIDER = 'memory';

const { sniffImage, imageDimensions, stripMetadata, inspectImage } = await import('../../src/utils/imageInspect.js');
const { __private } = await import('../../src/utils/safeFetch.js');

function makeWebp(width, height) {
  // VP8X header (with the EXIF flag set) + EXIF chunk + minimal VP8L header.
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08;
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const exif = Buffer.from('SECRET-WEBP-GPS!', 'ascii');
  const vp8l = Buffer.from([0x2f, 0, 0, 0, 0, 0]);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32LE(data.length, 4);
    return Buffer.concat([head, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([chunk('VP8X', vp8x), chunk('EXIF', exif), chunk('VP8L', vp8l)]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

test('file type comes from the bytes, not the name', () => {
  assert.equal(sniffImage(makePng(10, 10))?.mimeType, 'image/png');
  assert.equal(sniffImage(makeJpeg())?.mimeType, 'image/jpeg');
  assert.equal(sniffImage(makeWebp(20, 30))?.mimeType, 'image/webp');
  assert.equal(sniffImage(Buffer.from('<?php echo "not an image"; ?>'.padEnd(64, ' '))), null);
  assert.equal(sniffImage(Buffer.from('GIF89a'.padEnd(64, '\0'))), null, 'GIF is not accepted');
});

test('dimensions are read for PNG, JPEG and WebP', () => {
  assert.deepEqual(imageDimensions(makePng(321, 123), 'image/png'), { width: 321, height: 123 });
  assert.deepEqual(imageDimensions(makeJpeg(640, 480), 'image/jpeg'), { width: 640, height: 480 });
  assert.deepEqual(imageDimensions(makeWebp(1024, 768), 'image/webp'), { width: 1024, height: 768 });
});

test('PNG text chunks are removed and the image data is untouched', () => {
  const original = makePng(64, 64, { text: 'SECRET-PNG-LOCATION' });
  const clean = stripMetadata(original, 'image/png');
  assert.ok(original.includes('SECRET-PNG-LOCATION'));
  assert.ok(!clean.includes('SECRET-PNG-LOCATION'));
  assert.deepEqual(clean, makePng(64, 64));
});

test('JPEG EXIF and comments are removed but the orientation is kept', () => {
  const original = makeJpeg(600, 800, { orientation: 6, secret: 'SECRET-GPS-48.8584N' });
  const clean = stripMetadata(original, 'image/jpeg');
  assert.ok(original.includes('SECRET-GPS-48.8584N'));
  assert.ok(!clean.includes('SECRET-GPS-48.8584N'));
  assert.ok(!clean.includes('camera serial'));
  // A minimal EXIF block with Orientation = 6 is written back.
  const exifAt = clean.indexOf('Exif\0\0');
  assert.ok(exifAt > 0);
  assert.equal(clean.readUInt16BE(exifAt + 6 + 18), 6);
  assert.deepEqual(imageDimensions(clean, 'image/jpeg'), { width: 600, height: 800 });
  // Orientation 1 (normal) needs no EXIF at all.
  assert.equal(stripMetadata(makeJpeg(100, 100, { orientation: 1 }), 'image/jpeg').indexOf('Exif'), -1);
});

test('WebP EXIF chunk and flag are removed', () => {
  const original = makeWebp(300, 300);
  const clean = stripMetadata(original, 'image/webp');
  assert.ok(!clean.includes('SECRET-WEBP-GPS'));
  assert.equal(clean[20] & 0x08, 0, 'EXIF flag cleared');
  assert.equal(clean.readUInt32LE(4), clean.length - 8, 'RIFF size updated');
  assert.deepEqual(imageDimensions(clean, 'image/webp'), { width: 300, height: 300 });
});

test('inspectImage enforces size limits with clear codes', () => {
  assert.throws(() => inspectImage(makePng(100, 100), { minSide: 256 }), (error) => error.code === 'IMAGE_TOO_SMALL');
  assert.throws(() => inspectImage(makePng(300, 300), { minSide: 1, maxSide: 200 }), (error) => error.code === 'IMAGE_TOO_LARGE');
  assert.throws(() => inspectImage(Buffer.from('hello world, not an image at all')), (error) => error.code === 'UNSUPPORTED_FILE_TYPE');
  const truncated = makeJpeg().subarray(0, 30);
  assert.throws(() => inspectImage(truncated), (error) => error.code === 'UNREADABLE_IMAGE');
  const ok = inspectImage(makePng(400, 500, { text: 'x' }), { minSide: 256 });
  assert.equal(ok.mimeType, 'image/png');
  assert.equal(ok.width, 400);
});

test('downloads refuse private and internal addresses', () => {
  const { isPrivateAddress } = __private;
  for (const address of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.5.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  for (const address of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) {
    assert.equal(isPrivateAddress(address), false, address);
  }
});
