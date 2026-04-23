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

  test('buildErdMermaid synthesises entity blocks and fk relationships', () => {
    const src = schemaModel.buildErdMermaid({
      source: 'pg',
      tables: [
        {
          name: 'users',
          comment: null,
          columns: [
            { name: 'id',    type: 'bigint',  nullable: false, default: null, primary: true,  unique: false, comment: null },
            { name: 'email', type: 'varchar', nullable: false, default: null, primary: false, unique: true,  comment: null },
          ],
          foreign_keys: [],
          indexes: [],
        },
        {
          name: 'posts',
          comment: null,
          columns: [
            { name: 'id',      type: 'bigint', nullable: false, default: null, primary: true,  unique: false, comment: null },
            { name: 'user_id', type: 'bigint', nullable: false, default: null, primary: false, unique: false, comment: null },
          ],
          foreign_keys: [{
            columns: ['user_id'],
            references_table: 'users',
            references_columns: ['id'],
            on_delete: 'CASCADE',
            on_update: null,
          }],
          indexes: [],
        },
      ],
      warnings: [],
    });
    expect(src).toMatch(/^erDiagram/);
    expect(src).toMatch(/USERS \{[\s\S]+?bigint id PK/);
    expect(src).toMatch(/varchar email UK/);
    expect(src).toMatch(/POSTS \{[\s\S]+?bigint user_id FK/);
    expect(src).toMatch(/USERS \|\|--o\{ POSTS : "user_id"/);
  });

  test('buildErdMermaid returns null for an empty schema', () => {
    expect(schemaModel.buildErdMermaid(null)).toBeNull();
    expect(schemaModel.buildErdMermaid({ source: 'x', tables: [], warnings: [] })).toBeNull();
  });

  test('renders every index on a separate bulleted line (regression)', () => {
    // Regression: before Phase 6D the rendered DOCX collapsed the bullet
    // list into a single run-on paragraph ("Индексы: - idx1: a - idx2: b …").
    // That turned out to be a template-loader side-effect, but the schema
    // emitter itself must always produce one "- " per index so downstream
    // renderers cannot glue them together accidentally.
    const md = schemaModel.buildMarkdown({
      source: 'pg',
      tables: [{
        name: 'action_log', comment: null, columns: [], foreign_keys: [],
        indexes: [
          { name: 'idx_action_log_action',  columns: ['action'],         unique: false },
          { name: 'idx_action_log_created', columns: ['created_at'],     unique: false },
          { name: 'idx_action_log_entity',  columns: ['entity_type', 'entity_id'], unique: false },
          { name: 'idx_action_log_ip',      columns: ['ip_address'],     unique: false },
          { name: 'idx_action_log_result',  columns: ['result'],         unique: false },
          { name: 'idx_action_log_user_created', columns: ['user_id', 'created_at'], unique: false },
        ],
      }],
      warnings: [],
    });
    const idxBlock = md.split('**Индексы:**')[1] || '';
    const bulletLines = idxBlock.split('\n').filter((l) => /^\s*-\s+idx_action_log_/.test(l));
    expect(bulletLines).toHaveLength(6);
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
