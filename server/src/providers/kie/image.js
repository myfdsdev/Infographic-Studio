import { findModel, InputError } from './capabilities.js';

/** Build a createTask payload for an image model. Throws InputError on bad input. */
export function buildImageTask(modelId, params) {
  const model = findModel(modelId);
  if (!model || model.kind !== 'image') throw new InputError(`Unknown image model "${modelId}"`, 'model');
  return { model: model.id, input: model.build(params) };
}
