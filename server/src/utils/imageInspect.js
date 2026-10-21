// Minimal, dependency-free image inspection for uploads and saved results.
//
//   sniffImage(buffer)            real type from magic bytes (never trust the
//                                 file name or the browser's Content-Type)
//   imageDimensions(buffer, mime) width/height from the file headers
//   stripMetadata(buffer, mime)   removes EXIF/XMP/text chunks (GPS location,
//                                 camera serials, editing history) before a
//                                 photo is stored or sent to a provider.
//
// JPEG orientation is preserved: phone photos rely on the EXIF Orientation
// tag, so a minimal EXIF block holding only that tag is written back.

export const IMAGE_TYPES = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
});

export function sniffImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mimeType: 'image/jpeg', ext: 'jpg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: 'image/png', ext: 'png' };
  }
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', ext: 'webp' };
  }
  return null;
}

// ---------------------------------------------------------------- JPEG

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const JPEG_STANDALONE = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9]);

/** Walk JPEG segments up to (not including) the scan data. */
function jpegSegments(buffer) {
  const segments = [];
  let offset = 2; // after SOI
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null; // corrupt
    let marker = buffer[offset + 1];
    let start = offset;
    while (marker === 0xff) {
      start += 1;
      marker = buffer[start + 1];
    }
    if (marker === undefined) return null;
    if (JPEG_STANDALONE.has(marker)) {
      segments.push({ marker, start, end: start + 2 });
      offset = start + 2;
      if (marker === 0xd9) break;
      continue;
    }
    if (start + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(start + 2);
    const end = start + 2 + length;
    if (length < 2 || end > buffer.length) return null;
    segments.push({ marker, start, end });
    offset = end;
    if (marker === 0xda) {
      // Start of scan: everything after this is entropy-coded data.
      segments.scanStart = start;
      break;
    }
  }
  return segments;
}

function jpegOrientation(buffer, segment) {
  // APP1 "Exif\0\0" + TIFF header
  const base = segment.start + 4;
  if (buffer.toString('ascii', base, base + 6) !== 'Exif\0\0') return null;
  const tiff = base + 6;
  const order = buffer.toString('ascii', tiff, tiff + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return null;
  const u16 = (at) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  try {
    const ifd = tiff + u32(tiff + 4);
    const count = u16(ifd);
    for (let i = 0; i < count; i += 1) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > segment.end) return null;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function orientationSegment(orientation) {
  // Big-endian TIFF with one IFD entry: Orientation (0x0112), SHORT, count 1.
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write('MM', 0, 'ascii');
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  tiff.writeUInt32BE(0, 22);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff]);
  const header = Buffer.alloc(4);
  header[0] = 0xff;
  header[1] = 0xe1;
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function jpegDimensions(buffer) {
  const segments = jpegSegments(buffer);
  if (!segments) return null;
  for (const segment of segments) {
    if (JPEG_SOF.has(segment.marker) && segment.end - segment.start >= 9) {
      return { height: buffer.readUInt16BE(segment.start + 5), width: buffer.readUInt16BE(segment.start + 7) };
    }
  }
  return null;
}

// APP1 = EXIF/XMP, APP13 = Photoshop/IPTC, COM = comments. APP0 (JFIF),
// APP2 (ICC colour profile) and APP14 (Adobe colour transform) are kept.
const JPEG_DROP = new Set([0xe1, 0xed, 0xfe]);

function stripJpeg(buffer) {
  const segments = jpegSegments(buffer);
  if (!segments || segments.scanStart === undefined) throw new Error('Unreadable JPEG structure');
  let orientation = null;
  const kept = [buffer.subarray(0, 2)];
  for (const segment of segments) {
    if (segment.marker === 0xda) break;
    if (segment.marker === 0xe1 && orientation === null) orientation = jpegOrientation(buffer, segment);
    if (JPEG_DROP.has(segment.marker)) continue;
    kept.push(buffer.subarray(segment.start, segment.end));
  }
  if (orientation && orientation !== 1) kept.splice(1, 0, orientationSegment(orientation));
  kept.push(buffer.subarray(segments.scanStart));
  return Buffer.concat(kept);
}

// ---------------------------------------------------------------- PNG

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function pngChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) return null;
    chunks.push({ type, start: offset, end });
    offset = end;
    if (type === 'IEND') break;
  }
  return chunks;
}

function stripPng(buffer) {
  const chunks = pngChunks(buffer);
  if (!chunks || chunks[0]?.type !== 'IHDR') throw new Error('Unreadable PNG structure');
  return Buffer.concat([buffer.subarray(0, 8), ...chunks.filter((c) => !PNG_DROP.has(c.type)).map((c) => buffer.subarray(c.start, c.end))]);
}

// ---------------------------------------------------------------- WebP

function webpChunks(buffer) {
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (offset + 8 + size > buffer.length) return null;
    chunks.push({ type, start: offset, end: Math.min(end, buffer.length) });
    offset = end;
  }
  return chunks;
}

function webpDimensions(buffer) {
  const chunks = webpChunks(buffer);
  if (!chunks || !chunks.length) return null;
  const first = chunks[0];
  const data = first.start + 8;
  if (first.type === 'VP8X' && buffer.length >= data + 10) {
    return { width: 1 + buffer.readUIntLE(data + 4, 3), height: 1 + buffer.readUIntLE(data + 7, 3) };
  }
  if (first.type === 'VP8 ' && buffer.length >= data + 10) {
    if (buffer[data + 3] !== 0x9d || buffer[data + 4] !== 0x01 || buffer[data + 5] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(data + 6) & 0x3fff, height: buffer.readUInt16LE(data + 8) & 0x3fff };
  }
  if (first.type === 'VP8L' && buffer.length >= data + 5 && buffer[data] === 0x2f) {
    const b0 = buffer[data + 1];
    const b1 = buffer[data + 2];
    const b2 = buffer[data + 3];
    const b3 = buffer[data + 4];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

function stripWebp(buffer) {
  const chunks = webpChunks(buffer);
  if (!chunks || !chunks.length) throw new Error('Unreadable WebP structure');
  const parts = [];
  for (const chunk of chunks) {
    if (chunk.type === 'EXIF' || chunk.type === 'XMP ') continue;
    let bytes = buffer.subarray(chunk.start, chunk.end);
    if (chunk.type === 'VP8X') {
      bytes = Buffer.from(bytes);
      bytes[8] &= ~(0x08 | 0x04); // clear the EXIF and XMP flags
    }
    parts.push(bytes);
  }
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

// ---------------------------------------------------------------- API

export function imageDimensions(buffer, mimeType) {
  try {
    if (mimeType === 'image/png') {
      if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mimeType === 'image/jpeg') return jpegDimensions(buffer);
    if (mimeType === 'image/webp') return webpDimensions(buffer);
  } catch {
    return null;
  }
  return null;
}

/** Returns a copy without metadata. Throws if the structure cannot be parsed. */
export function stripMetadata(buffer, mimeType) {
  if (mimeType === 'image/jpeg') return stripJpeg(buffer);
  if (mimeType === 'image/png') return stripPng(buffer);
  if (mimeType === 'image/webp') return stripWebp(buffer);
  throw new Error(`Unsupported image type ${mimeType}`);
}

/**
 * Full check used for uploads and saved results: real type, readable size,
 * sane dimensions, metadata removed.
 * @returns {{ buffer: Buffer, mimeType: string, ext: string, width: number, height: number }}
 */
export function inspectImage(buffer, { minSide = 1, maxSide = 12000 } = {}) {
  const type = sniffImage(buffer);
  if (!type) {
    const error = new Error('The file is not a JPEG, PNG or WebP image');
    error.code = 'UNSUPPORTED_FILE_TYPE';
    throw error;
  }
  const size = imageDimensions(buffer, type.mimeType);
  if (!size || !size.width || !size.height) {
    const error = new Error('The image could not be read; it may be damaged');
    error.code = 'UNREADABLE_IMAGE';
    throw error;
  }
  if (size.width < minSide || size.height < minSide) {
    const error = new Error(`The image is too small (${size.width}x${size.height}). Use one at least ${minSide} pixels on each side.`);
    error.code = 'IMAGE_TOO_SMALL';
    throw error;
  }
  if (size.width > maxSide || size.height > maxSide) {
    const error = new Error(`The image is too large (${size.width}x${size.height}). Use one at most ${maxSide} pixels on each side.`);
    error.code = 'IMAGE_TOO_LARGE';
    throw error;
  }
  let clean;
  try {
    clean = stripMetadata(buffer, type.mimeType);
  } catch {
    const error = new Error('The image could not be read; it may be damaged');
    error.code = 'UNREADABLE_IMAGE';
    throw error;
  }
  return { buffer: clean, mimeType: type.mimeType, ext: type.ext, width: size.width, height: size.height };
}
