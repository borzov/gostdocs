const { applyNfrPolicy, findNfrSections, isNfrSection, PLACEHOLDER_RU, PLACEHOLDER_EN } =
  require('../skills/gostdocs/scripts/lib/nfr-policy');

describe('isNfrSection', () => {
  test.each([
    ['NFR', true],
    ['nfr', true],
    ['NFR_PERFORMANCE', true],
    ['NON_FUNCTIONAL_REQUIREMENTS', true],
    ['HARDWARE', true],
    ['LOAD', true],
    ['FEATURES', false],
    ['DATABASE', false],
  ])('%s -> %s', (key, expected) => {
    expect(isNfrSection(key)).toBe(expected);
  });
});

describe('findNfrSections', () => {
  test('extracts NFR-like sections only', () => {
    const agg = {
      sections: [
        { section: 'FEATURES', found: true },
        { section: 'NFR', found: false },
        { section: 'PERFORMANCE', found: true },
      ],
    };
    const nfr = findNfrSections(agg);
    expect(nfr.map((s) => s.section)).toEqual(['NFR', 'PERFORMANCE']);
  });

  test('lifts sections out of nested coverage.json shape', () => {
    // research.js writes `{ aggregate: { sections: [...] } }` to disk; the
    // generator forwards the raw coverage object here without un-nesting.
    const coverage = {
      gost_mode: 'strict',
      aggregate: {
        sections: [
          { section: 'NFR', found: false },
          { section: 'PERFORMANCE', found: true },
          { section: 'FEATURES', found: true },
        ],
      },
    };
    const nfr = findNfrSections(coverage);
    expect(nfr.map((s) => s.section)).toEqual(['NFR', 'PERFORMANCE']);
  });
});

describe('applyNfrPolicy — strict mode', () => {
  test('missing NFR section creates placeholder directive + blocker', () => {
    const agg = { sections: [{ section: 'NFR', found: false }] };
    const result = applyNfrPolicy(agg, 'strict');
    expect(result.directives).toHaveLength(1);
    expect(result.directives[0].text).toBe(PLACEHOLDER_RU);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].scope).toBe('nfr:NFR');
  });

  test('no NFR sections in coverage at all blocks in strict', () => {
    const agg = { sections: [{ section: 'FEATURES', found: true }] };
    const result = applyNfrPolicy(agg, 'strict');
    expect(result.blockers).toHaveLength(1);
    expect(result.directives).toEqual([]);
  });

  test('found NFR section emits nothing', () => {
    const agg = { sections: [{ section: 'NFR', found: true }] };
    const result = applyNfrPolicy(agg, 'strict');
    expect(result.directives).toEqual([]);
    expect(result.blockers).toEqual([]);
  });
});

describe('applyNfrPolicy — lite mode', () => {
  test('missing NFR section creates placeholder + warning (no blocker)', () => {
    const agg = { sections: [{ section: 'NFR', found: false }] };
    const result = applyNfrPolicy(agg, 'lite');
    expect(result.directives).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.blockers).toEqual([]);
  });

  test('no NFR sections warns but does not block', () => {
    const agg = { sections: [{ section: 'FEATURES', found: true }] };
    const result = applyNfrPolicy(agg, 'lite');
    expect(result.warnings).toHaveLength(1);
    expect(result.blockers).toEqual([]);
  });
});

describe('applyNfrPolicy — language', () => {
  test('en produces English placeholder', () => {
    const agg = { sections: [{ section: 'NFR', found: false }] };
    const result = applyNfrPolicy(agg, 'lite', { lang: 'en' });
    expect(result.directives[0].text).toBe(PLACEHOLDER_EN);
  });

  test('unknown lang falls back to ru', () => {
    const agg = { sections: [{ section: 'NFR', found: false }] };
    const result = applyNfrPolicy(agg, 'lite', { lang: 'kz' });
    expect(result.directives[0].text).toBe(PLACEHOLDER_RU);
  });
});
