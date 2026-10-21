// Provider adapters behind one interface, so services and job handlers never
// talk to a vendor API directly.
//
//   verifyKey(apiKey)                 -> { balance }      (no generation)
//   buildTask(kind, model, params)    -> { model, input } (throws InputError)
//   submit(apiKey, task, { callBackUrl }) -> taskId
//   fetchTask(apiKey, taskId)         -> normalised task
//   models()                          -> public catalogue
import * as kieClient from './kie/client.js';
import { normalizeTask } from './kie/status.js';
import { buildImageTask } from './kie/image.js';
import { describeModels, findModel, InputError, isAssetRef, ASSET_REF_PREFIX } from './kie/capabilities.js';

export { InputError, isAssetRef, ASSET_REF_PREFIX };
export { ProviderError } from './kie/client.js';

const kie = Object.freeze({
  key: 'kie',
  name: 'Kie.ai',
  description: 'Z-Image infographic generation through the Kie.ai unified jobs API.',
  website: 'https://kie.ai',
  docs: 'https://docs.kie.ai',
  keyPage: 'https://kie.ai/api-key',
  async verifyKey(apiKey) {
    return { balance: await kieClient.getCredits(apiKey) };
  },
  buildTask(kind, modelId, params) {
    if (kind === 'image') return buildImageTask(modelId, params);
    const model = findModel(modelId);
    if (!model || model.kind !== kind) throw new InputError(`Unknown ${kind} model "${modelId}"`, 'model');
    return { model: model.id, input: model.build(params) };
  },
  findModel,
  async submit(apiKey, task, { callBackUrl } = {}) {
    return kieClient.createTask(apiKey, { ...task, callBackUrl });
  },
  async fetchTask(apiKey, taskId) {
    return normalizeTask(await kieClient.getTask(apiKey, taskId));
  },
  /** Hand a stored file to the provider. Returns { url, expiresAt }. */
  async uploadFile(apiKey, file) {
    return kieClient.uploadFile(apiKey, file);
  },
  /** Fresh download link for a generated file. */
  async getDownloadUrl(apiKey, fileUrl) {
    return kieClient.getDownloadUrl(apiKey, fileUrl);
  },
  models: describeModels,
});

const PROVIDERS = Object.freeze({ kie });

export const PROVIDER_KEYS = Object.freeze(Object.keys(PROVIDERS));

export function getProvider(key) {
  return PROVIDERS[key] || null;
}

export function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({
    key: provider.key,
    name: provider.name,
    description: provider.description,
    website: provider.website,
    docs: provider.docs,
    keyPage: provider.keyPage,
    models: provider.models(),
  }));
}
