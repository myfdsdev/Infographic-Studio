#!/usr/bin/env node
// Create every MongoDB index declared by the models. Safe to run repeatedly:
// missing indexes are created and existing ones are left untouched.
//
//   npm run db:indexes -w server
import mongoose from 'mongoose';

const { env } = await import('../src/config/env.js');
const { ensureIndexes } = await import('../src/models/index.js');

try {
  console.log(`Connecting to MongoDB database "${env.databaseName}"...`);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.databaseName, serverSelectionTimeoutMS: 10000 });
  const models = await ensureIndexes();
  console.log(`Indexes ensured for: ${models.join(', ')}`);
  process.exitCode = 0;
} catch (error) {
  console.error(`Could not create indexes: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
