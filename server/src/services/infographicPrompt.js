// Prompt builder for infographics on Z-Image (Kie.ai).
//
// Z-Image accepts at most 1000 prompt characters, so the fixed instructions
// for layout, design quality, accuracy and the chosen style are kept short and
// the user's topic is capped at TOPIC_MAX. The longest topic with the longest
// layout, style and ratio still fits (see PROMPT_MAX and the tests). Every
// ratio offered here (1:1, 3:4, 9:16) is a real Z-Image `aspect_ratio` value,
// so the shape is sent as a parameter and only described as a composition hint.
//
// An infographic is described by two independent choices:
//   - a layout (what structure the content takes: steps, timeline, ...)
//   - a style (how it looks: minimal, dark neon, hand-drawn, ...)

export const TOPIC_MIN = 10;
export const TOPIC_MAX = 400;
// Z-Image's documented prompt limit.
export const PROMPT_MAX = 1000;

export const LAYOUTS = Object.freeze({
  auto: {
    id: 'auto',
    label: 'Smart layout',
    summary: 'Picks the clearest structure for your topic.',
    directive: 'Layout: pick the clearest structure for the topic; 4-8 sections, each an icon, bold heading and one short line.',
  },
  list: {
    id: 'list',
    label: 'Tips list',
    summary: 'Numbered cards for tips, benefits or key points.',
    directive: 'Layout: tips list, 4-8 numbered cards in a grid, each a big number, icon, bold heading and one short line.',
  },
  steps: {
    id: 'steps',
    label: 'Step-by-step',
    summary: 'A numbered process joined by arrows.',
    directive: 'Layout: step-by-step process, 3-7 numbered steps joined by arrows, each an icon, bold heading and one short line.',
  },
  timeline: {
    id: 'timeline',
    label: 'Timeline',
    summary: 'Milestones in order along a line.',
    directive: 'Layout: timeline, a central line with 3-8 milestones in order, each a date or stage label, icon and one short line.',
  },
  comparison: {
    id: 'comparison',
    label: 'Comparison',
    summary: 'Two options side by side, point by point.',
    directive: 'Layout: side-by-side comparison, two columns with headers, matching rows of icon and short point, a VS badge between.',
  },
  pros_cons: {
    id: 'pros_cons',
    label: 'Pros & cons',
    summary: 'Advantages and drawbacks in two columns.',
    directive: 'Layout: pros and cons, a green Pros column with check icons and a red Cons column with cross icons, 3-5 points each.',
  },
  statistics: {
    id: 'statistics',
    label: 'Statistics',
    summary: 'Big numbers and simple charts from your data.',
    directive: 'Layout: data dashboard, numbers given in the topic as big labelled figures with simple bar, donut or icon charts.',
  },
  cycle: {
    id: 'cycle',
    label: 'Cycle',
    summary: 'Stages that repeat in a loop.',
    directive: 'Layout: circular cycle, 3-6 stages around a loop with curved arrows, each an icon, heading and short line.',
  },
  mindmap: {
    id: 'mindmap',
    label: 'Mind map',
    summary: 'A central idea with connected branches.',
    directive: 'Layout: mind map, a central topic bubble with 4-8 branches, each a coloured node with icon, heading and short line.',
  },
});

export const STYLES = Object.freeze({
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    summary: 'Simple layout, clean typography, neutral colours, generous whitespace.',
    directive: 'Style: minimal, white background, charcoal text, one soft accent, thin line icons, airy whitespace.',
  },
  corporate: {
    id: 'corporate',
    label: 'Corporate',
    summary: 'Professional business design, structured sections, clear icons and diagrams.',
    directive: 'Style: corporate, navy and slate with one accent, light background, flat icons, section header bars.',
  },
  colorful: {
    id: 'colorful',
    label: 'Colorful',
    summary: 'Vibrant but professional, friendly illustrations, strong visual hierarchy.',
    directive: 'Style: vibrant yet professional, colour-coded sections, friendly flat illustrations, rounded icons.',
  },
  dark: {
    id: 'dark',
    label: 'Dark Neon',
    summary: 'Dark background with glowing neon accents, sleek and techy.',
    directive: 'Style: dark mode, near-black navy background, glowing neon cyan and magenta accents, light text, line icons.',
  },
  pastel: {
    id: 'pastel',
    label: 'Pastel',
    summary: 'Soft pastel colours, rounded cards, friendly and calm.',
    directive: 'Style: soft pastel mint, peach and lavender, cream background, rounded cards, cute flat icons.',
  },
  sketch: {
    id: 'sketch',
    label: 'Hand-drawn',
    summary: 'Sketchnote look with marker lettering and doodles.',
    directive: 'Style: hand-drawn sketchnote, marker lettering, doodle icons and arrows, off-white paper, black ink, two accents.',
  },
  isometric: {
    id: 'isometric',
    label: 'Isometric 3D',
    summary: 'Modern 3D isometric illustrations with soft shadows.',
    directive: 'Style: isometric 3D illustrations, soft shadows, blue and teal palette, light background.',
  },
  retro: {
    id: 'retro',
    label: 'Retro',
    summary: 'Vintage poster with warm muted colours and bold type.',
    directive: 'Style: retro vintage poster, cream paper, muted orange, teal and mustard, bold condensed type, badges.',
  },
  gradient: {
    id: 'gradient',
    label: 'Gradient',
    summary: 'Purple-to-blue gradient with glassy cards, very modern.',
    directive: 'Style: modern purple-to-blue gradient background, frosted glass white cards, white text, rounded icons.',
  },
});

export const DEFAULT_LAYOUT = 'auto';

export const ASPECT_RATIOS = Object.freeze({
  '1:1': { id: '1:1', label: 'Square', hint: 'Square canvas, balanced grid.' },
  '3:4': { id: '3:4', label: 'Portrait', hint: 'Portrait canvas, top-to-bottom flow.' },
  '9:16': { id: '9:16', label: 'Vertical', hint: 'Tall vertical canvas, stacked sections.' },
});

// Ratios offered before the switch to Z-Image; regenerating one uses the
// closest shape Z-Image supports.
export const LEGACY_RATIOS = Object.freeze({ '4:5': '3:4' });

const QUALITY = 'Bold headline and subtitle, strong hierarchy, consistent icon set, aligned grid, crisp correctly spelled text, no paragraphs.';

const RULES = 'Use only facts from the topic; never invent numbers, dates or sources. No logos or watermarks.';

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

export function buildInfographicPrompt({ topic, style, aspectRatio, layout = DEFAULT_LAYOUT }) {
  const styleDef = STYLES[style];
  const ratioDef = ASPECT_RATIOS[aspectRatio];
  const layoutDef = LAYOUTS[layout];
  if (!styleDef) throw new Error(`Unknown style "${style}"`);
  if (!ratioDef) throw new Error(`Unknown aspect ratio "${aspectRatio}"`);
  if (!layoutDef) throw new Error(`Unknown layout "${layout}"`);
  const prompt = [
    `Premium infographic poster about: "${cleanTopic(topic).replace(/\s+/g, ' ')}".`,
    layoutDef.directive,
    ratioDef.hint,
    styleDef.directive,
    QUALITY,
    RULES,
  ].join(' ');
  if (prompt.length > PROMPT_MAX) throw new Error(`Infographic prompt is ${prompt.length} characters; the model accepts ${PROMPT_MAX}`);
  return prompt;
}

export function describeOptions() {
  return {
    layouts: Object.values(LAYOUTS).map(({ id, label, summary }) => ({ id, label, summary })),
    styles: Object.values(STYLES).map(({ id, label, summary }) => ({ id, label, summary })),
    aspectRatios: Object.values(ASPECT_RATIOS).map(({ id, label }) => ({ id, label })),
    topic: { min: TOPIC_MIN, max: TOPIC_MAX },
  };
}
