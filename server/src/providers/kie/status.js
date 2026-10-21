// Normalise Kie.ai task details (GET /api/v1/jobs/recordInfo) into the shape
// the job system uses.
//
//   provider state  -> normalised
//   waiting|queuing -> pending
//   generating      -> running
//   success         -> succeeded
//   fail            -> failed

const STATE_MAP = {
  waiting: 'pending',
  queuing: 'pending',
  generating: 'running',
  success: 'succeeded',
  fail: 'failed',
};

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function httpsUrls(list) {
  return (Array.isArray(list) ? list : []).filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
}

export function normalizeTask(data) {
  const state = STATE_MAP[data?.state] || 'pending';
  const result = parseJson(data?.resultJson) || data?.response || {};
  const param = parseJson(data?.param) || {};
  return {
    taskId: data?.taskId || null,
    model: data?.model || null,
    providerState: data?.state || null,
    state,
    resultUrls: state === 'succeeded' ? httpsUrls(result.resultUrls) : [],
    lastFrameUrls: state === 'succeeded' ? httpsUrls(result.lastFrameUrl) : [],
    error:
      state === 'failed'
        ? { code: data?.failCode ? String(data.failCode) : 'GENERATION_FAILED', message: data?.failMsg || 'Generation failed' }
        : null,
    creditsConsumed: typeof data?.creditsConsumed === 'number' ? data.creditsConsumed : null,
    costTimeSeconds: typeof data?.costTime === 'number' ? data.costTime : null,
    // The original request as the provider recorded it; used to prove a task
    // reported by a callback really belongs to a given job.
    callBackUrl: typeof param.callBackUrl === 'string' ? param.callBackUrl : null,
  };
}
