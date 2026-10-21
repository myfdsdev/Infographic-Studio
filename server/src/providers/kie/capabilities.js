// Kie.ai image model catalogue for AI Infographic Studio.
//
// Every entry was checked against the official documentation at docs.kie.ai
// (Market models, unified jobs API) on 2026-10-13. Each `doc` link is the page
// the field names and limits come from. Only models that use the unified
// POST /api/v1/jobs/createTask + GET /api/v1/jobs/recordInfo flow are listed,
// so one client, one poller and one callback handler cover all of them.
//
// `build(params)` turns the app's provider-neutral parameters into the exact
// `input` object the model expects, and throws InputError for anything the
// model does not accept. Prices are not published per model in the docs, so
// none are hard-coded; the provider reports `creditsConsumed` per task.

export class InputError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'InputError';
    this.field = field;
  }
}

const IMAGE_URL_LIMIT = 2048;

// Stored images are referenced as "asset://<id>" inside a job and replaced by a
// provider-reachable URL right before submission (see jobs/handlers). Only the
// server creates these: the public API accepts https URLs only.
export const ASSET_REF_PREFIX = 'asset://';
const ASSET_REF = /^asset:\/\/[a-f0-9]{24}$/;

export function isAssetRef(value) {
  return typeof value === 'string' && ASSET_REF.test(value);
}

function requirePrompt(params, { min = 1, max }) {
  const prompt = String(params.prompt || '').trim();
  if (prompt.length < min) throw new InputError(min > 1 ? `Prompt must be at least ${min} characters` : 'Prompt is required', 'prompt');
  if (prompt.length > max) throw new InputError(`Prompt must be ${max} characters or fewer for this model`, 'prompt');
  return prompt;
}

function optionalPrompt(params, { max }) {
  const prompt = String(params.prompt || '').trim();
  if (prompt.length > max) throw new InputError(`Prompt must be ${max} characters or fewer for this model`, 'prompt');
  return prompt || undefined;
}

function pick(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new InputError(`${field} must be one of: ${allowed.join(', ')}`, field);
  return value;
}

function urls(list, field, { min = 0, max }) {
  const values = (Array.isArray(list) ? list : []).filter(Boolean);
  if (values.length < min) throw new InputError(`This model needs at least ${min} reference image${min === 1 ? '' : 's'}`, field);
  if (values.length > max) throw new InputError(`This model accepts at most ${max} reference images`, field);
  for (const value of values) {
    if (isAssetRef(value)) continue;
    if (typeof value !== 'string' || value.length > IMAGE_URL_LIMIT || !/^https:\/\//i.test(value)) {
      throw new InputError('Reference images must be public https URLs', field);
    }
  }
  return values;
}

function noFrames(params, model) {
  if (params.firstFrameUrl || params.lastFrameUrl) throw new InputError(`${model} does not take first/last frames`, 'firstFrameUrl');
}

const NB2_RATIOS = ['1:1', '2:3', '3:2', '1:4', '4:1', '3:4', '4:3', '4:5', '5:4', '1:8', '8:1', '9:16', '16:9', '21:9', 'auto'];
const NB_EDIT_RATIOS = ['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9', 'auto'];
const GROK_IMG_RATIOS = ['1:1', '2:3', '3:2', '16:9', '9:16'];
const Z_IMAGE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export const KIE_MODELS = Object.freeze([
  // ---------------------------------------------------------------- image
  {
    id: 'nano-banana-2',
    kind: 'image',
    label: 'Nano Banana 2',
    description: 'Text-to-image with up to 10 optional reference images; 1K/2K/4K output.',
    doc: 'https://docs.kie.ai/market/google/nanobanana2.md',
    limits: { prompt: 20000, referenceImages: { min: 0, max: 10 } },
    options: { aspectRatios: NB2_RATIOS, resolutions: ['1K', '2K', '4K'], outputFormats: ['png', 'jpg'] },
    defaults: { aspectRatio: 'auto', resolution: '1K', outputFormat: 'png' },
    build(params) {
      noFrames(params, this.label);
      const refs = urls(params.referenceImageUrls, 'referenceImageUrls', { max: 10 });
      return {
        prompt: requirePrompt(params, { max: 20000 }),
        ...(refs.length ? { image_input: refs } : {}),
        aspect_ratio: pick(params.aspectRatio, NB2_RATIOS, 'aspectRatio', 'auto'),
        resolution: pick(params.resolution, ['1K', '2K', '4K'], 'resolution', '1K'),
        output_format: pick(params.outputFormat, ['png', 'jpg'], 'outputFormat', 'png'),
      };
    },
  },
  {
    id: 'google/nano-banana-edit',
    kind: 'image',
    label: 'Nano Banana Edit',
    description: 'Edits or restyles 1 to 10 reference images from a prompt.',
    doc: 'https://docs.kie.ai/market/google/nano-banana-edit.md',
    limits: { prompt: 20000, referenceImages: { min: 1, max: 10 } },
    options: { aspectRatios: NB_EDIT_RATIOS, outputFormats: ['png', 'jpeg'] },
    defaults: { aspectRatio: '1:1', outputFormat: 'png' },
    build(params) {
      noFrames(params, this.label);
      return {
        prompt: requirePrompt(params, { max: 20000 }),
        image_urls: urls(params.referenceImageUrls, 'referenceImageUrls', { min: 1, max: 10 }),
        aspect_ratio: pick(params.aspectRatio, NB_EDIT_RATIOS, 'aspectRatio', '1:1'),
        output_format: pick(params.outputFormat, ['png', 'jpeg'], 'outputFormat', 'png'),
      };
    },
  },
  {
    id: 'grok-imagine-image-2-0/text-to-image',
    kind: 'image',
    label: 'Grok Imagine Image 2.0',
    description: 'Text-to-image (no reference images).',
    doc: 'https://docs.kie.ai/market/grok-imagine-image-2-0/text-to-image.md',
    limits: { prompt: 8000, referenceImages: { min: 0, max: 0 } },
    options: { aspectRatios: GROK_IMG_RATIOS },
    defaults: { aspectRatio: '1:1' },
    build(params) {
      noFrames(params, this.label);
      urls(params.referenceImageUrls, 'referenceImageUrls', { max: 0 });
      return {
        prompt: requirePrompt(params, { max: 8000 }),
        aspect_ratio: pick(params.aspectRatio, GROK_IMG_RATIOS, 'aspectRatio', '1:1'),
      };
    },
  },
  {
    id: 'grok-imagine-image-2-0/image-edit',
    kind: 'image',
    label: 'Grok Imagine Image 2.0 Edit',
    description: 'Image edit from 1 to 5 reference images.',
    doc: 'https://docs.kie.ai/market/grok-imagine-image-2-0/image-to-image.md',
    limits: { prompt: 8000, referenceImages: { min: 1, max: 5 } },
    options: { aspectRatios: [...GROK_IMG_RATIOS, 'auto'] },
    defaults: { aspectRatio: 'auto' },
    build(params) {
      noFrames(params, this.label);
      const prompt = optionalPrompt(params, { max: 8000 });
      return {
        ...(prompt ? { prompt } : {}),
        image_urls: urls(params.referenceImageUrls, 'referenceImageUrls', { min: 1, max: 5 }),
        aspect_ratio: pick(params.aspectRatio, [...GROK_IMG_RATIOS, 'auto'], 'aspectRatio', 'auto'),
      };
    },
  },
  {
    // Checked against the doc on 2026-10-15; output is PNG.
    id: 'z-image',
    kind: 'image',
    label: 'Z-Image',
    description: 'Fast, low-cost text-to-image (no reference images).',
    doc: 'https://docs.kie.ai/market/z-image/z-image.md',
    limits: { prompt: 1000, referenceImages: { min: 0, max: 0 } },
    options: { aspectRatios: Z_IMAGE_RATIOS },
    defaults: { aspectRatio: '1:1' },
    build(params) {
      noFrames(params, this.label);
      urls(params.referenceImageUrls, 'referenceImageUrls', { max: 0 });
      return {
        prompt: requirePrompt(params, { max: 1000 }),
        aspect_ratio: pick(params.aspectRatio, Z_IMAGE_RATIOS, 'aspectRatio', '1:1'),
        // Kie.ai's own content filter (off unless asked for).
        nsfw_checker: true,
      };
    },
  },
]);

export function findModel(id) {
  return KIE_MODELS.find((model) => model.id === id) || null;
}

/** Public description of the catalogue (no functions). */
export function describeModels() {
  return KIE_MODELS.map(({ id, kind, label, description, doc, limits, options, defaults }) => ({
    id,
    kind,
    label,
    description,
    doc,
    limits,
    options,
    defaults,
  }));
}
