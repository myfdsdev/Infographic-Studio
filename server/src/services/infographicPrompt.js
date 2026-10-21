// Prompt builder for infographics on Z-Image (Kie.ai).
//
// Z-Image accepts at most 1000 prompt characters, so the fixed instructions
// for layout, typography, accuracy and the chosen style are kept short and the
// user's topic is capped at TOPIC_MAX. The longest topic with the longest
// style and ratio still fits (see PROMPT_MAX). Every ratio offered here (1:1,
// 3:4, 9:16) is a real Z-Image `aspect_ratio` value, so the shape is sent as a
// parameter and only described in the prompt as a composition hint.

export const TOPIC_MIN = 10;
export const TOPIC_MAX = 400;
// Z-Image's documented prompt limit.
export const PROMPT_MAX = 1000;

export const STYLES = Object.freeze({
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    summary: 'Simple layout, clean typography, neutral colours, generous whitespace.',
    directive: 'Style: minimal, airy grid, lots of whitespace, clean sans-serif, white background, charcoal text, one soft accent, thin line icons.',
  },
  corporate: {
    id: 'corporate',
    label: 'Corporate',
    summary: 'Professional business design, structured sections, clear icons and diagrams.',
    directive: 'Style: corporate, structured sections with headers, flat icons, simple diagrams, navy and slate palette with one accent, light background.',
  },
  colorful: {
    id: 'colorful',
    label: 'Colorful',
    summary: 'Vibrant but professional, friendly illustrations, strong visual hierarchy.',
    directive: 'Style: vibrant yet professional, colour-coded sections, friendly flat illustrations, rounded icons, bold title, light background.',
  },
});

export const ASPECT_RATIOS = Object.freeze({
  '1:1': { id: '1:1', label: 'Square', hint: 'square layout, sections in a balanced grid' },
  '3:4': { id: '3:4', label: 'Portrait', hint: 'portrait layout, sections flowing top to bottom' },
  '9:16': { id: '9:16', label: 'Vertical', hint: 'tall vertical layout, sections stacked top to bottom' },
});

// Ratios offered before the switch to Z-Image; regenerating one uses the
// closest shape Z-Image supports.
export const LEGACY_RATIOS = Object.freeze({ '4:5': '3:4' });

const COMPOSITION =
  'One complete infographic poster: bold title at top, then separated sections, each with a short heading, a brief phrase and an icon; numbered if sequential. Aligned grid, large sharp correctly spelled text, no paragraphs.';

const RULES = 'Use only facts from the topic; never invent numbers, dates or sources. No logos, watermarks or placeholder text.';

/** Collapse whitespace and strip control characters from the user's topic. */
export function cleanTopic(topic) {
  return String(topic || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A short title for lists: the first sentence or line of the topic. */
export function titleFromTopic(topic) {
  const text = cleanTopic(topic).replace(/\s+/g, ' ');
  const first = text.split(/(?<=[.!?])\s|\n/)[0] || text;
  return first.length > 100 ? `${first.slice(0, 99).trimEnd()}…` : first;
}

export function buildInfographicPrompt({ topic, style, aspectRatio }) {
  const styleDef = STYLES[style];
  const ratioDef = ASPECT_RATIOS[aspectRatio];
  if (!styleDef) throw new Error(`Unknown style "${style}"`);
  if (!ratioDef) throw new Error(`Unknown aspect ratio "${aspectRatio}"`);
  const prompt = [
    `Professional infographic about: "${cleanTopic(topic).replace(/\s+/g, ' ')}".`,
    COMPOSITION,
    `Format: ${ratioDef.hint}.`,
    styleDef.directive,
    RULES,
  ].join(' ');
  if (prompt.length > PROMPT_MAX) throw new Error(`Infographic prompt is ${prompt.length} characters; the model accepts ${PROMPT_MAX}`);
  return prompt;
}

export function describeOptions() {
  return {
    styles: Object.values(STYLES).map(({ id, label, summary }) => ({ id, label, summary })),
    aspectRatios: Object.values(ASPECT_RATIOS).map(({ id, label }) => ({ id, label })),
    topic: { min: TOPIC_MIN, max: TOPIC_MAX },
  };
}
