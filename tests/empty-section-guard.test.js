'use strict';

const dm = require('../skills/gostdocs/scripts/lib/doc-model');
const guard = require('../skills/gostdocs/scripts/lib/empty-section-guard');

function buildDocWithEmptyLeaf() {
  const doc = dm.newDocument({ title: 'T', lang: 'ru-RU' });
  const root = dm.addSection(doc, dm.newSection({ heading: 'Безопасность', level: 1 }));
  root.children.push(dm.newSection({ heading: 'Аутентификация', level: 2 }));
  root.children.push(dm.newSection({ heading: 'Авторизация', level: 2 }));
  return doc;
}

describe('applyEmptySectionGuard', () => {
  test('strict mode injects a visible TODO admonition into each empty leaf', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'strict' }, lang: 'ru', warnings: [], blockers: [] };
    const result = guard.applyEmptySectionGuard(doc, ctx);
    expect(result.touchedSections).toEqual(
      expect.arrayContaining(['Безопасность › Аутентификация', 'Безопасность › Авторизация']),
    );
    const auth = doc.sections[0].children[0];
    expect(auth.elements).toHaveLength(1);
    expect(auth.elements[0].type).toBe('admonition');
    expect(auth.elements[0].kind).toBe('todo');
    expect(auth.elements[0].text).toMatch(/не удалось автоматически заполнить/i);
  });

  test('lite mode drops empty leaf sections entirely', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    const result = guard.applyEmptySectionGuard(doc, ctx);
    expect(result.droppedSections).toEqual(
      expect.arrayContaining(['Безопасность › Аутентификация', 'Безопасность › Авторизация']),
    );
    // The parent container now has no children and itself becomes empty, so
    // it is also dropped post-order.
    expect(doc.sections).toHaveLength(0);
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

  test('lite mode records drops in ctx.warnings', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'lite' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    expect(ctx.warnings.length).toBeGreaterThan(0);
    expect(ctx.warnings[0].scope).toBe('empty-section');
    expect(ctx.warnings[0].message).toMatch(/dropped/);
    expect(ctx.blockers).toHaveLength(0);
  });

  test('table with only a header is treated as empty (strict mode)', () => {
    const doc = dm.newDocument({ title: 'T', lang: 'ru-RU' });
    const s = dm.addSection(doc, dm.newSection({ heading: 'S', level: 1 }));
    s.elements.push({ type: 'table', caption: 'Пусто', headers: ['A', 'B'], rows: [] });
    const ctx = { meta: { gost_mode: 'strict' }, lang: 'ru', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    expect(s.elements.some((e) => e.type === 'admonition' && e.kind === 'todo')).toBe(true);
  });

  test('English mode uses English TODO text (strict)', () => {
    const doc = buildDocWithEmptyLeaf();
    const ctx = { meta: { gost_mode: 'strict' }, lang: 'en', warnings: [], blockers: [] };
    guard.applyEmptySectionGuard(doc, ctx);
    const auth = doc.sections[0].children[0];
    expect(auth.elements[0].type).toBe('admonition');
    expect(auth.elements[0].text).toMatch(/could not be auto-populated/i);
  });
});
