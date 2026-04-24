'use strict';

/**
 * Non-Functional Requirements (NFR) policy for strict vs lite GOST mode.
 *
 * v0.3 requirement 8.3: when specs do not provide numeric NFRs (hardware,
 * load, performance), the skill must NOT invent figures. Instead:
 *   - strict mode: emit a placeholder "подлежит уточнению с архитектором"
 *     and fail the validation phase if the placeholder reaches a published
 *     document without being filled in
 *   - lite mode:  emit a placeholder + warning; publication still proceeds
 *
 * This module is a pure policy decider. It consumes an aggregated coverage
 * report (from research-result.js) and emits directives that Phase 6
 * generation applies to the Doc-Model.
 */

const NFR_SECTION_KEYS = [
  'NFR',
  'NON_FUNCTIONAL_REQUIREMENTS',
  'PERFORMANCE',
  'HARDWARE',
  'LOAD',
  'SCALABILITY',
];

const PLACEHOLDER_RU = 'Подлежит уточнению с архитектором';
const PLACEHOLDER_EN = 'Pending clarification with the architect';

function isNfrSection(key) {
  const normalised = String(key).toUpperCase().replace(/[^A-Z_]/g, '_');
  return NFR_SECTION_KEYS.some((k) => normalised === k || normalised.startsWith(`${k}_`));
}

/**
 * Extract the flat sections list regardless of where the caller put it.
 *
 * Historically `research.js` writes `coverage.json` as
 * `{ aggregate: { sections: [...] } }`, while unit tests often pass the
 * bare `aggregate` object directly. `generate.js` forwards the raw coverage
 * report here, so `.sections` needs to be reachable from both shapes —
 * lifting it explicitly keeps the policy decider agnostic to that choice.
 *
 * @param {object|null|undefined} aggregate
 * @returns {Array<{ section: string, found: boolean }>}
 */
function liftSections(aggregate) {
  if (!aggregate || typeof aggregate !== 'object') return [];
  if (Array.isArray(aggregate.sections)) return aggregate.sections;
  if (aggregate.aggregate && Array.isArray(aggregate.aggregate.sections)) {
    return aggregate.aggregate.sections;
  }
  return [];
}

/**
 * @param {{ sections: Array<{ section: string, found: boolean }> }} aggregate
 * @returns {Array<{ section: string, found: boolean }>}
 */
function findNfrSections(aggregate) {
  return liftSections(aggregate).filter((s) => s && isNfrSection(s.section));
}

/**
 * @param {{ sections: Array<{ section: string, found: boolean }> }} aggregate
 * @param {'strict'|'lite'} gostMode
 * @param {{ lang?: 'ru'|'en' }} [opts]
 * @returns {{
 *   directives: Array<{ section: string, action: 'placeholder'|'warn', text: string|null }>,
 *   warnings: Array<{ scope: string, message: string }>,
 *   blockers: Array<{ scope: string, message: string }>,
 * }}
 */
function applyNfrPolicy(aggregate, gostMode, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const placeholder = lang === 'en' ? PLACEHOLDER_EN : PLACEHOLDER_RU;

  const directives = [];
  const warnings = [];
  const blockers = [];

  const nfrSections = findNfrSections(aggregate);
  if (nfrSections.length === 0) {
    // No NFR sections declared in research schema at all.
    if (gostMode === 'strict') {
      blockers.push({
        scope: 'nfr',
        message: 'strict mode: research did not declare any NFR sections; a NFR section is required in specs or research output',
      });
    } else {
      warnings.push({ scope: 'nfr', message: 'no NFR section reported; generation will proceed without non-functional requirements' });
    }
    return { directives, warnings, blockers };
  }

  for (const section of nfrSections) {
    if (section.found) continue;
    directives.push({ section: section.section, action: 'placeholder', text: placeholder });
    if (gostMode === 'strict') {
      blockers.push({
        scope: `nfr:${section.section}`,
        message: `strict mode: NFR section "${section.section}" has no source; a placeholder will be inserted and validation will fail until the section is filled in`,
      });
    } else {
      warnings.push({
        scope: `nfr:${section.section}`,
        message: `NFR section "${section.section}" will be filled with a placeholder`,
      });
    }
  }

  return { directives, warnings, blockers };
}

module.exports = {
  applyNfrPolicy,
  findNfrSections,
  isNfrSection,
  NFR_SECTION_KEYS,
  PLACEHOLDER_RU,
  PLACEHOLDER_EN,
};
