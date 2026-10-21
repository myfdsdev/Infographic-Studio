import mongoose from 'mongoose';

export const JOB_STATUSES = Object.freeze(['queued', 'processing', 'completed', 'failed', 'cancelled']);
export const JOB_KINDS = Object.freeze(['image']);

// Fine-grained step inside `status`:
//   pending_submit  waiting to send the task to the provider
//   submitting      write-ahead marker: a createTask call is (or was) in flight
//   polling         the provider task id is known; checking its status
//   reconcile       a submission outcome is unknown; looking for evidence of
//                   the provider task before anything is resent
//   done            terminal
export const JOB_PHASES = Object.freeze(['pending_submit', 'submitting', 'polling', 'reconcile', 'done']);

const eventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

const generationJobSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: JOB_KINDS, required: true },
    provider: { type: String, required: true },
    model: { type: String, required: true },
    // Provider-ready payload ({ model, input }). Contains prompts and public
    // reference URLs only; never credentials.
    request: { type: mongoose.Schema.Types.Mixed, required: true },
    // Optional link to the feature record the job serves (infographic).
    subjectType: { type: String, default: null },
    subjectId: { type: String, default: null },
    // Feature-specific details of the subject (e.g. the infographic style and
    // shape). Never contains credentials.
    subjectMeta: { type: mongoose.Schema.Types.Mixed, default: null },
    // Stored images the request refers to as "asset://<id>" placeholders.
    // They are uploaded to the provider right before submission.
    assetIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    prepareAttempts: { type: Number, default: 0 },

    status: { type: String, enum: JOB_STATUSES, default: 'queued' },
    phase: { type: String, enum: JOB_PHASES, default: 'pending_submit' },

    providerTaskId: { type: String, default: null },
    providerState: { type: String, default: null },
    submitAttempts: { type: Number, default: 0 },
    maxSubmitAttempts: { type: Number, default: 3 },
    submissionStartedAt: { type: Date, default: null },
    submissionUncertain: { type: Boolean, default: false },
    reconcileDeadline: { type: Date, default: null },
    callbackTokenHash: { type: String, default: null, select: false },
    pollCount: { type: Number, default: 0 },
    pollErrors: { type: Number, default: 0 },

    result: {
      urls: { type: [String], default: undefined },
      lastFrameUrls: { type: [String], default: undefined },
      creditsConsumed: { type: Number, default: null },
      costTimeSeconds: { type: Number, default: null },
    },
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null, maxlength: 1000 },
    },

    idempotencyKey: { type: String, default: null },
    inputHash: { type: String, required: true },
    retryOf: { type: mongoose.Schema.Types.ObjectId, ref: 'GenerationJob', default: null },
    cancelRequested: { type: Boolean, default: false },

    // Scheduling and exclusive processing (lease).
    nextRunAt: { type: Date, default: Date.now },
    lockedBy: { type: String, default: null },
    lockedUntil: { type: Date, default: null },
    timeoutAt: { type: Date, required: true },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },

    events: { type: [eventSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

generationJobSchema.index({ status: 1, nextRunAt: 1 });
generationJobSchema.index({ userId: 1, createdAt: -1 });
generationJobSchema.index({ userId: 1, status: 1, phase: 1 });
generationJobSchema.index(
  { userId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);
generationJobSchema.index({ userId: 1, inputHash: 1, createdAt: -1 });
generationJobSchema.index({ providerTaskId: 1 }, { sparse: true });
generationJobSchema.index({ assetIds: 1, status: 1 });
generationJobSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });

export const GenerationJob = mongoose.models.GenerationJob || mongoose.model('GenerationJob', generationJobSchema);
export default GenerationJob;
