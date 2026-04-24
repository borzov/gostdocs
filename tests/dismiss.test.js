const { applyDismiss, mergeSelectors } = require('../skills/gostdocs/scripts/lib/dismiss');

function makeLocator({ visible = true, clickable = true } = {}) {
  return {
    first: jest.fn(function () { return this; }),
    waitFor: jest.fn(async () => {
      if (!visible) throw new Error('not visible');
    }),
    click: jest.fn(async () => {
      if (!clickable) throw new Error('click blocked');
    }),
  };
}

function makePage(locatorMap) {
  return {
    locator: jest.fn((selector) => locatorMap[selector] || makeLocator({ visible: false })),
  };
}

describe('applyDismiss', () => {
  test('returns empty for empty selector list', async () => {
    const result = await applyDismiss(makePage({}), []);
    expect(result).toEqual({ clicked: [], skipped: [] });
  });

  test('clicks visible selectors and reports skipped', async () => {
    const page = makePage({
      '.cookie': makeLocator({ visible: true }),
      '.ghost': makeLocator({ visible: false }),
    });
    const result = await applyDismiss(page, ['.cookie', '.ghost']);
    expect(result.clicked).toEqual(['.cookie']);
    expect(result.skipped).toEqual(['.ghost']);
  });

  test('never throws on click failure', async () => {
    const page = makePage({
      '.banner': makeLocator({ visible: true, clickable: false }),
    });
    const result = await applyDismiss(page, ['.banner']);
    expect(result.clicked).toEqual([]);
    expect(result.skipped).toEqual(['.banner']);
  });

  test('skips empty strings and non-strings', async () => {
    const page = makePage({});
    const result = await applyDismiss(page, ['', null, 42]);
    expect(result.clicked).toEqual([]);
    expect(result.skipped.length).toBe(3);
  });

  test('invokes logger when provided', async () => {
    const page = makePage({ '.ok': makeLocator({ visible: true }) });
    const logs = [];
    await applyDismiss(page, ['.ok'], { logger: (m) => logs.push(m) });
    expect(logs.some((l) => l.includes('.ok'))).toBe(true);
  });
});

describe('mergeSelectors', () => {
  test('concatenates and dedupes', () => {
    const meta = { auth: { dismiss_selectors: ['.a', '.b'] } };
    const pageCfg = { dismiss: ['.b', '.c'] };
    expect(mergeSelectors(meta, pageCfg)).toEqual(['.a', '.b', '.c']);
  });

  test('handles missing config', () => {
    expect(mergeSelectors({}, null)).toEqual([]);
    expect(mergeSelectors({ auth: {} }, undefined)).toEqual([]);
  });

  test('ignores non-string entries', () => {
    const meta = { auth: { dismiss_selectors: ['.a', 123, null] } };
    expect(mergeSelectors(meta)).toEqual(['.a']);
  });
});
