'use strict';

const {
  buildUrlWithQuery,
  interactionToActionStep,
  interactionsToActionSteps,
} = require('../skills/gen-docs/scripts/lib/interactions');

describe('buildUrlWithQuery', () => {
  test('returns the URL unchanged when no query params are passed', () => {
    expect(buildUrlWithQuery('http://x/y', null)).toBe('http://x/y');
    expect(buildUrlWithQuery('http://x/y', {})).toBe('http://x/y');
  });

  test('appends a single key/value pair', () => {
    expect(buildUrlWithQuery('http://x/events', { format: 'online' }))
      .toBe('http://x/events?format=online');
  });

  test('appends multiple parameters in deterministic order', () => {
    const out = buildUrlWithQuery('http://x/events', { format: 'online', sort: '-starts_at' });
    expect(out).toBe('http://x/events?format=online&sort=-starts_at');
  });

  test('preserves an existing query string and appends to it', () => {
    const out = buildUrlWithQuery('http://x/events?lang=ru', { sort: 'asc' });
    expect(out).toBe('http://x/events?lang=ru&sort=asc');
  });
});

describe('interactionToActionStep', () => {
  test('click → { click: selector }', () => {
    expect(interactionToActionStep({ action: 'click', selector: 'button.x' }))
      .toEqual({ click: 'button.x' });
  });

  test('expand is treated as click (DOM-wise the same)', () => {
    expect(interactionToActionStep({ action: 'expand', selector: '[data-faq=1]' }))
      .toEqual({ click: '[data-faq=1]' });
  });

  test('fill → { fill: { selector: value } }', () => {
    expect(interactionToActionStep({ action: 'fill', selector: 'input[name=q]', value: 'регистрация' }))
      .toEqual({ fill: { 'input[name=q]': 'регистрация' } });
  });

  test('wait_for / wait_ms / scroll', () => {
    expect(interactionToActionStep({ action: 'wait_for', selector: '.loaded' }))
      .toEqual({ wait_for: '.loaded' });
    expect(interactionToActionStep({ action: 'wait_ms', ms: 500 })).toEqual({ wait_ms: 500 });
    expect(interactionToActionStep({ action: 'scroll', selector: '#footer' }))
      .toEqual({ wait_for: '#footer' });
  });

  test('rejects malformed steps', () => {
    expect(interactionToActionStep(null)).toBeNull();
    expect(interactionToActionStep({})).toBeNull();
    expect(interactionToActionStep({ action: 'click' })).toBeNull(); // no selector
    expect(interactionToActionStep({ action: 'unknown', selector: 'x' })).toBeNull();
  });
});

describe('interactionsToActionSteps', () => {
  test('skips invalid entries silently', () => {
    const out = interactionsToActionSteps([
      { action: 'click', selector: 'a' },
      null,
      { action: 'unknown', selector: 'b' },
      { action: 'fill', selector: 'i', value: 'v' },
    ]);
    expect(out).toEqual([
      { click: 'a' },
      { fill: { i: 'v' } },
    ]);
  });

  test('returns [] for non-array input', () => {
    expect(interactionsToActionSteps(undefined)).toEqual([]);
    expect(interactionsToActionSteps(null)).toEqual([]);
    expect(interactionsToActionSteps('x')).toEqual([]);
  });
});
