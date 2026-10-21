// MongoDB connection management (Mongoose).
//
// The HTTP server starts regardless of database availability so that liveness
// and readiness endpoints can report the real state. The first connection is
// retried on a timer; after that, Mongoose's own reconnection logic takes over.
import mongoose from 'mongoose';

const READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

const state = {
  lastError: null,
  connectedAt: null,
  attempts: 0,
  retryTimer: null,
  stopped: false,
};

mongoose.set('strictQuery', true);
// Indexes are created explicitly by ensureIndexes() (models/index.js) after the
// connection opens, so production never builds indexes implicitly.
mongoose.set('autoIndex', false);

function redactUri(uri) {
  return String(uri).replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:***@');
}

/**
 * Connect to MongoDB. Resolves `true` when connected. With `retry` enabled a
 * failed attempt schedules another one in the background and resolves `false`;
 * without it the error is thrown.
 */
export async function connectDatabase({ env, logger, retry = true, onConnected } = {}) {
  state.stopped = false;
  const uri = env.MONGODB_URI;
  const retryMs = env.MONGODB_RETRY_SECONDS * 1000;

  mongoose.connection.removeAllListeners('connected');
  mongoose.connection.removeAllListeners('disconnected');
  mongoose.connection.removeAllListeners('error');
  mongoose.connection.on('connected', () => {
    state.connectedAt = new Date();
    state.lastError = null;
    logger?.info({ db: mongoose.connection.name }, 'MongoDB connected');
    if (onConnected) {
      Promise.resolve()
        .then(onConnected)
        .catch((error) => logger?.error({ reason: error.message }, 'Post-connect task failed'));
    }
  });
  mongoose.connection.on('disconnected', () => {
    state.connectedAt = null;
    logger?.warn('MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => {
    state.lastError = err.message;
    // The attempt() handler below already logs each failed connection with
    // its reason; a one-line message here keeps the log readable.
    logger?.error({ reason: err.message }, 'MongoDB connection error');
  });

  const attempt = async () => {
    state.attempts += 1;
    try {
      await mongoose.connect(uri, {
        dbName: env.databaseName,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
      });
      return true;
    } catch (err) {
      state.lastError = err.message;
      const willRetry = retry && !state.stopped;
      logger?.error(
        { attempt: state.attempts, uri: redactUri(uri), reason: err.message },
        `MongoDB connection failed${willRetry ? ` - retrying in ${env.MONGODB_RETRY_SECONDS}s` : ''}`,
      );
      if (willRetry) {
        clearTimeout(state.retryTimer);
        state.retryTimer = setTimeout(attempt, retryMs);
        state.retryTimer.unref?.();
        return false;
      }
      if (!retry) throw err;
      return false;
    }
  };

  return attempt();
}

export async function disconnectDatabase() {
  state.stopped = true;
  clearTimeout(state.retryTimer);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

/** Snapshot of the connection used by the readiness endpoint. */
export function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;
  return {
    state: READY_STATES[readyState] || 'unknown',
    connected: readyState === 1,
    host: readyState === 1 ? mongoose.connection.host : null,
    name: readyState === 1 ? mongoose.connection.name : null,
    connectedAt: state.connectedAt,
    attempts: state.attempts,
    lastError: readyState === 1 ? null : state.lastError,
  };
}

/** Round-trip ping; returns latency in ms or null when unreachable. */
export async function pingDatabase() {
  if (mongoose.connection.readyState !== 1) return null;
  const started = process.hrtime.bigint();
  try {
    await mongoose.connection.db.admin().command({ ping: 1 });
    return Number(process.hrtime.bigint() - started) / 1e6;
  } catch {
    return null;
  }
}
