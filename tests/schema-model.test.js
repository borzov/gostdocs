const schemaModel = require('../skills/gen-docs/scripts/lib/schema-model');

describe('validate', () => {
  test('empty schema validates', () => {
    expect(schemaModel.validate(schemaModel.empty('test'))).toEqual({
      source: 'test', tables: [], warnings: [],
    });
  });

  test('rejects missing source', () => {
    expect(() => schemaModel.validate({ tables: [] })).toThrow();
  });

  test('accepts full table definition', () => {
    const s = {
      source: '/p/schema.prisma',
      tables: [{
        name: 'users', comment: null, columns: [
          { name: 'id', type: 'Int', nullable: false, default: null, primary: true, unique: false, comment: null },
        ],
        foreign_keys: [], indexes: [],
      }],
      warnings: [],
    };
    expect(schemaModel.validate(s).tables[0].name).toBe('users');
  });
});

describe('columnTypeWithModifiers', () => {
  test('appends PK / NOT NULL / default', () => {
    const col = { type: 'Int', primary: true, unique: false, nullable: false, default: 'autoincrement()' };
    expect(schemaModel.columnTypeWithModifiers(col)).toBe('Int (PK, NOT NULL, default autoincrement())');
  });

  test('plain type when no modifiers', () => {
    expect(schemaModel.columnTypeWithModifiers({
      type: 'String', primary: false, unique: false, nullable: true, default: null,
    })).toBe('String');
  });
});

describe('buildMarkdown', () => {
  test('returns empty string for no tables', () => {
    expect(schemaModel.buildMarkdown({ source: 'x', tables: [], warnings: [] })).toBe('');
  });

  test('emits table with columns and FK', () => {
    const md = schemaModel.buildMarkdown({
      source: 'x',
      tables: [{
        name: 'posts', comment: null,
        columns: [
          { name: 'id', type: 'Int', nullable: false, default: null, primary: true, unique: false, comment: null },
          { name: 'author_id', type: 'Int', nullable: false, default: null, primary: false, unique: false, comment: null },
        ],
        foreign_keys: [{
          columns: ['author_id'], references_table: 'users', references_columns: ['id'],
          on_delete: 'CASCADE', on_update: null,
        }],
        indexes: [],
      }],
      warnings: [],
    });
    expect(md).toMatch(/### posts/);
    expect(md).toMatch(/\| id \| Int \(PK, NOT NULL\)/);
    expect(md).toMatch(/Внешние ключи/);
    expect(md).toMatch(/author_id → users\(id\) \(ON DELETE CASCADE\)/);
  });

  test('emits indexes section', () => {
    const md = schemaModel.buildMarkdown({
      source: 'x',
      tables: [{
        name: 't', comment: null, columns: [], foreign_keys: [],
        indexes: [
          { name: 'idx_a', columns: ['a'], unique: false },
          { name: null, columns: ['b', 'c'], unique: true },
        ],
      }],
      warnings: [],
    });
    expect(md).toMatch(/Индексы/);
    expect(md).toMatch(/idx_a: a/);
    expect(md).toMatch(/b, c \(UNIQUE\)/);
  });

  test('english lang', () => {
    const md = schemaModel.buildMarkdown(
      {
        source: 'x',
        tables: [{
          name: 't', comment: null,
          columns: [{ name: 'id', type: 'Int', nullable: false, default: null, primary: true, unique: false, comment: null }],
          foreign_keys: [], indexes: [],
        }],
        warnings: [],
      },
      { lang: 'en' },
    );
    expect(md).toMatch(/\| Column \| Type \| Description \|/);
  });
});
