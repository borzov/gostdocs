'use strict';

const rm = require('../skills/gostdocs/scripts/lib/role-model-render');

describe('buildRoleActivities', () => {
  test('returns a TODO admonition when role model is missing', () => {
    const el = rm.buildRoleActivities(null, { role: 'user' });
    expect(el).toHaveLength(1);
    expect(el[0].type).toBe('admonition');
    expect(el[0].kind).toBe('todo');
    expect(el[0].text).toMatch(/не была получена/);
  });

  test('returns a TODO when the requested role is not in the model', () => {
    const el = rm.buildRoleActivities([{ role: 'admin', activities: ['x'] }], { role: 'user' });
    expect(el[0].type).toBe('admonition');
    expect(el[0].text).toMatch(/«user»/);
  });

  test('renders label, activities, functions and limits as bullet lists', () => {
    const model = [{
      role: 'user',
      label: 'Зарегистрированный пользователь',
      activities: ['участие в мероприятиях', 'получение сертификатов'],
      functions: ['регистрация', 'просмотр программы', 'скачивание сертификата'],
      limits: ['не может редактировать чужие регистрации'],
    }];
    const el = rm.buildRoleActivities(model, { role: 'user' });
    const text = el.map((e) => e.content || e.text || '').join('\n');
    expect(text).toMatch(/Зарегистрированный пользователь/);
    expect(text).toMatch(/- участие в мероприятиях/);
    expect(text).toMatch(/- регистрация/);
    expect(text).toMatch(/- не может редактировать чужие регистрации/);
  });

  test('emits a TODO admonition for any list left empty by the agent', () => {
    const el = rm.buildRoleActivities(
      [{ role: 'user', activities: ['x'], functions: [], limits: [] }],
      { role: 'user' },
    );
    const todos = el.filter((e) => e.type === 'admonition' && e.kind === 'todo');
    expect(todos).toHaveLength(2); // functions + limits
  });

  test('role matching is case-insensitive', () => {
    const model = [{ role: 'ADMIN', activities: ['управление'] }];
    const el = rm.buildRoleActivities(model, { role: 'admin' });
    expect(el.some((e) => (e.content || '').includes('управление'))).toBe(true);
  });
});

describe('buildRbacMatrix', () => {
  test('TODO admonition on an empty matrix', () => {
    expect(rm.buildRbacMatrix(null)[0].type).toBe('admonition');
    expect(rm.buildRbacMatrix({ domains: [], rows: [] })[0].type).toBe('admonition');
  });

  test('emits a Doc-Model table with Role × domain headers', () => {
    const [table] = rm.buildRbacMatrix({
      domains: ['Users', 'Events', 'Reports'],
      rows: [
        { role: 'admin', cells: { Users: 'CRUD', Events: 'CRUD', Reports: 'read' } },
        { role: 'user',  cells: { Users: 'read', Events: 'read', Reports: '—' } },
      ],
    });
    expect(table.type).toBe('table');
    expect(table.headers).toEqual(['Роль', 'Users', 'Events', 'Reports']);
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]).toEqual(['admin', 'CRUD', 'CRUD', 'read']);
  });

  test('honours role labels override when provided', () => {
    const [table] = rm.buildRbacMatrix(
      { domains: ['X'], rows: [{ role: 'admin', cells: { X: 'CRUD' } }] },
      { roleLabels: { admin: 'Администратор' } },
    );
    expect(table.rows[0][0]).toBe('Администратор');
  });

  test('missing cells render as em-dash', () => {
    const [table] = rm.buildRbacMatrix({
      domains: ['Users', 'Events'],
      rows: [{ role: 'guest', cells: { Users: 'read' } }],
    });
    expect(table.rows[0]).toEqual(['guest', 'read', '—']);
  });
});
