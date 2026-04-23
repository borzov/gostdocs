'use strict';

/**
 * Journey → Doc-Model section renderer.
 *
 * A journey (see journeys.yaml) is a numbered sequence of steps, some of
 * which produced screenshots during the capture phase. This module
 * converts a validated journey into a Doc-Model section containing the
 * "step N — description" paragraphs interleaved with figures.
 *
 * Manifest entries are matched by `capture.journey.name` and
 * `capture.journey.step` so reruns with different screenshot filenames
 * still resolve correctly.
 *
 * Pure function.
 */

const STRINGS = {
  ru: { step: 'Шаг', intro: 'Последовательность действий:' },
  en: { step: 'Step', intro: 'Sequence of actions:' },
};

function selectLang(lang) {
  return String(lang || '').startsWith('en') ? 'en' : 'ru';
}

function findCaptureForStep(manifest, journeyName, stepIndex) {
  if (!manifest || !Array.isArray(manifest.captures)) return null;
  return manifest.captures.find((c) =>
    c.journey && c.journey.name === journeyName && c.journey.step === stepIndex,
  ) || null;
}

function stepDescription(step, lang) {
  if (step.caption) return step.caption;
  if (step.title) return step.title;
  if (step.goto) return lang === 'en' ? `Navigate to ${step.goto}` : `Перейти на ${step.goto}`;
  if (step.click) return lang === 'en' ? `Click ${step.click}` : `Нажать ${step.click}`;
  if (step.fill) {
    const fields = Object.keys(step.fill).join(', ');
    return lang === 'en' ? `Fill fields: ${fields}` : `Заполнить поля: ${fields}`;
  }
  return lang === 'en' ? 'Step' : 'Шаг';
}

/**
 * @param {{ name: string, description?: string, role: string, steps: Array<any> }} journey
 * @param {{ captures: Array<any> }} manifest
 * @param {{ lang?: 'ru'|'en', level?: number }} [opts]
 * @returns {{ heading: string, level: number, slug: string, elements: object[], children: any[] }}
 */
function renderJourneyToDocModel(journey, manifest, opts = {}) {
  if (!journey || !journey.name || !Array.isArray(journey.steps)) {
    throw new Error('journey must have name and steps[]');
  }
  const lang = selectLang(opts.lang);
  const level = opts.level || 2;
  const t = STRINGS[lang];

  /** @type {any[]} */
  const elements = [];
  if (journey.description) elements.push({ type: 'paragraph', text: journey.description });
  elements.push({ type: 'paragraph', text: t.intro });

  for (let i = 0; i < journey.steps.length; i++) {
    const step = journey.steps[i];
    const idx = step.index || i + 1;
    const description = stepDescription(step, lang);
    elements.push({ type: 'paragraph', text: `${t.step} ${idx}. ${description}` });
    if (step.screenshot) {
      const capture = findCaptureForStep(manifest, journey.name, idx);
      if (capture && capture.file) {
        elements.push({
          type: 'figure',
          caption: step.caption || description,
          file: capture.file,
        });
      }
    }
  }

  return {
    heading: journey.name,
    level,
    slug: `journey-${journey.name.replace(/[^a-zA-Z0-9-]+/g, '-').toLowerCase()}`,
    elements,
    children: [],
  };
}

/**
 * Render all journeys in a file into a parent "Examples of use" section.
 *
 * @param {{ journeys: Array<any> }} journeysFile
 * @param {{ captures: Array<any> }} manifest
 * @param {{ lang?: 'ru'|'en', headingLevel?: number }} [opts]
 */
function renderJourneysSection(journeysFile, manifest, opts = {}) {
  const lang = selectLang(opts.lang);
  const parentHeading = lang === 'en' ? 'Usage scenarios' : 'Примеры использования';
  const children = (journeysFile.journeys || []).map((j) =>
    renderJourneyToDocModel(j, manifest, { lang, level: (opts.headingLevel || 1) + 1 }),
  );
  return {
    heading: parentHeading,
    level: opts.headingLevel || 1,
    slug: 'usage-scenarios',
    elements: children.length === 0
      ? [{ type: 'paragraph', text: lang === 'en' ? 'No journeys defined.' : 'Сценарии не заданы.' }]
      : [],
    children,
  };
}

module.exports = {
  renderJourneyToDocModel,
  renderJourneysSection,
  findCaptureForStep,
  stepDescription,
  STRINGS,
};
