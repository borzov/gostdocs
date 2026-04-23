'use strict';

const dm = require('../skills/gen-docs/scripts/lib/doc-model');
const guard = require('../skills/gen-docs/scripts/lib/empty-section-guard');

function buildDocWithEmptyLeaf() {
  const doc = dm.newDocument({ title: 'T', lang: 'ru-RU' });
  const root = dm.addSection(doc, dm.newSection({ heading: 'Безопасность', level: 1 }));
  root.children.push(dm.newSection({ heading: 'Аутентификация', level: 2 }));
  root.children.push(dm.newSection({ heading: 'Авторизация', level: 2 }));
  return doc;
}

describe('applyEmptySectionGuard', () => {
  test('inserts a Russian placeholder into each empty leaf section', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    const result = guard.applyEmptySectionGuard(doc, ctx);
    expect(result.touchedSections).toEqual(
      expect.arrayContaining(['Безопасность › Аутентификация', 'Безопасность › Авторизация']),
    );
    const auth = doc.sections[0].children[0];
    expect(auth.elements).toHaveLength(1);
    expect(auth.elements[0].type).toBe('paragraph');
    expect(auth.elements[0].text).toMatch(/подлежит заполнению/i);
  });

  test('does not touch container heading that has populated children', () => {
    const doc = dm.newDocument({ title: 'T', lang: 'ru-RU' });
    const root = dm.addSection(doc, dm.newSection({ heading: 'Раздел', level: 1 }));
    const child = dm.newSection({ heading: 'Подраздел', level: 2 });
    child.elements.push({ type: 'paragraph', text: 'реальный текст' });
    root.children.push(child);
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    expect(root.elements).toHaveLength(0);
    expect(ctx.warnings).toHaveLength(0);
    expect(ctx.blockers).toHaveLength(0);
  });

  test('strict mode records findings in ctx.blockers', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'strict' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    expect(ctx.blockers.length).toBeGreaterThan(0);
    expect(ctx.blockers[0].scope).toBe('empty-section');
    expect(ctx.warnings).toHaveLength(0);
  });

  test('lite mode records findings in ctx.warnings', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    expect(ctx.warnings.length).toBeGreaterThan(0);
    expect(ctx.warnings[0].scope).toBe('empty-section');
    expect(ctx.blockers).toHaveLength(0);
  });

  test('table with only a header is treated as empty', () => {
    const doc = dm.newDocument({ title: 'T', lang: 'ru-RU' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'S', level: 1 }));
    s.elements.push({ type: 'table', caption: 'Пусто', headers: ['A', 'B'], rows: [] });
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    // Placeholder appended because the only element is a data-less table.
    expect(s.elements.some((e) => e.type === 'paragraph' && /подлежит заполнению/.test(e.text))).toBe(true);
  });

  test('English mode uses English placeholder', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'en', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    const auth = doc.sections[0].children[0];
    expect(auth.elements[0].text).toMatch(/pending/i);
  });
});
