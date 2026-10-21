#!/usr/bin/env node
// Development-only local MongoDB for machines without MongoDB installed.
//
//   npm run db:dev            (from the repo root)
//
// Starts a real mongod (downloaded once by mongodb-memory-server from
// fastdl.mongodb.org and cached) on 127.0.0.1:27017 with data persisted in
// server/.mongo-data, so accounts survive restarts. Point MONGODB_URI at
// mongodb://127.0.0.1:27017 to use it. Stop it with Ctrl+C.
//
// Not for production. Use a managed MongoDB (for example Atlas) there.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server-core';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.resolve(serverRoot, process.env.DEV_MONGO_DATA_DIR || '.mongo-data');
const port = Number(process.env.DEV_MONGO_PORT || 27017);

fs.mkdirSync(dbPath, { recursive: true });

console.log(`Starting development MongoDB on 127.0.0.1:${port} (data: ${dbPath})`);
console.log('The first run downloads the MongoDB server binary; this can take a minute.');

const mongod = await MongoMemoryServer.create({
  instance: { port, ip: '127.0.0.1', dbPath, storageEngine: 'wiredTiger' },
});

console.log(`Development MongoDB is running: ${mongod.getUri()}`);
console.log('Set MONGODB_URI=mongodb://127.0.0.1:' + port + ' in server/.env to use it. Press Ctrl+C to stop.');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping development MongoDB (data is kept)...');
  await mongod.stop({ doCleanup: false });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
