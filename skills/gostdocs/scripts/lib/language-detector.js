'use strict';

/**
 * Tiny char-class based language detector.
 *
 * Use case: the vision agent sometimes returns English prose in a field
 * that is supposed to be rendered into a Russian document (or vice
 * versa). We need a cheap, dependency-free check to decide whether a
 * string is predominantly the expected language before including it in
 * the narrative. A fully-featured NLP detector is overkill — the decision
 * is binary ("keep" / "drop"), the inputs are short, and we only care
 * about Cyrillic vs Latin.
 *
 * `detect(str)` returns `{ cyrillic, latin, total, dominant }` where
 * counts reflect letters only (digits, punctuation, whitespace skipped).
 * `matchesTargetLanguage(str, target)` is the main predicate — true when
 * the text is ≥ the target-language threshold of letters.
 */

const CYRILLIC_RE = /[А-Яа-яЁё]/g;
const LATIN_RE = /[A-Za-z]/g;

const DEFAULT_THRESHOLD = 0.5;

/**
 * @param {string|null|undefined} str
 * @returns {{ cyrillic: number, latin: number, total: number, dominant: 'cyrillic'|'latin'|'mixed'|'none' }}
 */
function detect(str) {
  if (typeof str !== 'string' || str.length === 0) {
    return { cyrillic: 0, latin: 0, total: 0, dominant: 'none' };
  }
  const cyrillic = (str.match(CYRILLIC_RE) || []).length;
  const latin = (str.match(LATIN_RE) || []).length;
  const total = cyrillic + latin;
  let dominant = 'none';
  if (total === 0) dominant = 'none';
  else if (cyrillic === 0) dominant = 'latin';
  else if (latin === 0) dominant = 'cyrillic';
  else if (cyrillic / total >= 0.8) dominant = 'cyrillic';
  else if (latin / total >= 0.8) dominant = 'latin';
  else dominant = 'mixed';
  return { cyrillic, latin, total, dominant };
}

/**
 * Return true when the string is likely the target language
 * (`ru` → Cyrillic-heavy, `en` → Latin-heavy). Short strings (< 10
 * letters) always pass — too little signal to reject confidently.
 *
 * @param {string|null|undefined} str
 * @param {'ru'|'en'} target
 * @param {number} [threshold=0.5]
 */
function matchesTargetLanguage(str, target, threshold = DEFAULT_THRESHOLD) {
  const info = detect(str);
  if (info.total < 10) return true;
  const minShare = Math.max(0, Math.min(1, threshold));
  if (target === 'en') return info.latin / info.total >= minShare;
  return info.cyrillic / info.total >= minShare;
}

module.exports = {
  detect,
  matchesTargetLanguage,
  DEFAULT_THRESHOLD,
};
