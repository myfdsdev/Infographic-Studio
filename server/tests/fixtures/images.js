// Small real image files for tests, built in code (no binary fixtures).
import zlib from 'node:zlib';

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData) >>> 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * A valid, decodable RGB PNG with diagonal stripes.
 * `text` adds a tEXt chunk (metadata that uploads must strip).
 */
export function makePng(width = 320, height = 400, { text = null, shade = 90 } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const stripe = Math.floor((x + y) / 24) % 2 === 0;
      const value = stripe ? shade : shade + 40;
      row[1 + x * 3] = value;
      row[2 + x * 3] = value;
      row[3 + x * 3] = value + 10;
    }
    rows.push(row);
  }
  const chunks = [pngChunk('IHDR', header)];
  if (text) chunks.push(pngChunk('tEXt', Buffer.from(`Comment\0${text}`, 'latin1')));
  chunks.push(pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

function segment(marker, payload) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/**
 * A structurally valid JPEG (markers, sizes, scan) for parser tests. It is not
 * meant to be decoded into pixels. Contains EXIF with an Orientation tag plus a
 * secret string, and a comment segment, which stripping must remove.
 */
export function makeJpeg(width = 600, height = 800, { orientation = 6, secret = 'SECRET-GPS-48.8584N' } = {}) {
  const jfif = Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  // Little-endian TIFF: one IFD with Orientation, then the secret bytes.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  const exif = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff, Buffer.from(secret, 'ascii')]);
  const sof = Buffer.alloc(15);
  sof[0] = 8;
  sof.writeUInt16BE(height, 1);
  sof.writeUInt16BE(width, 3);
  sof[5] = 3;
  sof.set([1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1], 6);
  const sos = Buffer.from([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const scan = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, jfif),
    segment(0xe1, exif),
    segment(0xfe, Buffer.from(`camera serial ${secret}`, 'ascii')),
    segment(0xc0, sof),
    segment(0xda, sos),
    scan,
    Buffer.from([0xff, 0xd9]),
  ]);
}
