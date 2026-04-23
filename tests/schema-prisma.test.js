const prisma = require('../skills/gen-docs/scripts/adapters/schema/prisma');

describe('splitBlocks', () => {
  test('extracts model and enum blocks', () => {
    const src = `
      model User {
        id Int @id
      }
      enum Role { ADMIN USER }
    `;
    const blocks = prisma.splitBlocks(src);
    expect(blocks.map((b) => b.kind + ':' + b.name)).toEqual(['model:User', 'enum:Role']);
  });

  test('handles nested braces in comments/defaults', () => {
    const src = `model A {
      id Int @default(value(10))
    }`;
    const blocks = prisma.splitBlocks(src);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].body).toMatch(/@default/);
  });
});

describe('parseAttributes', () => {
  test('handles multiple attrs with and without args', () => {
    const attrs = prisma.parseAttributes('@id @default(autoincrement()) @unique');
    const names = attrs.map((a) => a.name);
    expect(names).toEqual(['id', 'default', 'unique']);
    const dflt = attrs.find((a) => a.name === 'default');
    expect(dflt.argsRaw).toMatch(/autoincrement/);
  });
});

describe('parseFieldLine', () => {
  const warnings = [];

  test('parses scalar id field', () => {
    const r = prisma.parseFieldLine('id Int @id @default(autoincrement())', warnings);
    expect(r.column).toMatchObject({
      name: 'id', type: 'Int', primary: true, nullable: false, default: 'autoincrement()',
    });
    expect(r.foreignKey).toBeNull();
  });

  test('parses nullable string', () => {
    const r = prisma.parseFieldLine('name String?', warnings);
    expect(r.column).toMatchObject({ name: 'name', type: 'String', nullable: true });
  });

  test('parses unique field', () => {
    const r = prisma.parseFieldLine('email String @unique', warnings);
    expect(r.column.unique).toBe(true);
  });

  test('skips relation-side fields (non-scalar, no @relation args)', () => {
    const r = prisma.parseFieldLine('posts Post[]', warnings);
    expect(r.skip).toBe(true);
  });

  test('captures @relation as foreign key', () => {
    const r = prisma.parseFieldLine(
      'author User @relation(fields: [authorId], references: [id], onDelete: Cascade)',
      warnings,
    );
    expect(r.foreignKey).toMatchObject({
      columns: ['authorId'], references_table: 'User', references_columns: ['id'], on_delete: 'Cascade',
    });
    // The relation-side column itself is skipped (User is not a scalar)
    expect(r.skip).toBe(true);
  });

  test('@map adds a stored-as comment', () => {
    const r = prisma.parseFieldLine('userId Int @map("user_id")', warnings);
    expect(r.column.comment).toMatch(/user_id/);
  });
});

describe('parse', () => {
  test('parses a canonical two-model schema', () => {
    const src = `
      model User {
        id        Int      @id @default(autoincrement())
        email     String   @unique
        name      String?
        posts     Post[]
        createdAt DateTime @default(now())
        @@index([email])
        @@map("users")
      }

      model Post {
        id       Int    @id @default(autoincrement())
        title    String
        authorId Int
        author   User   @relation(fields: [authorId], references: [id], onDelete: Cascade)
      }
    `;
    const result = prisma.parse(src, { sourcePath: 'schema.prisma' });
    expect(result.tables).toHaveLength(2);
    const users = result.tables.find((t) => t.name === 'users');
    expect(users).toBeDefined();
    expect(users.columns.some((c) => c.name === 'email' && c.unique)).toBe(true);
    expect(users.indexes[0]).toMatchObject({ columns: ['email'], unique: false });

    const post = result.tables.find((t) => t.name === 'Post');
    expect(post.foreign_keys).toHaveLength(1);
    expect(post.foreign_keys[0].references_table).toBe('User');
  });

  test('empty source yields warning', () => {
    const r = prisma.parse('');
    expect(r.warnings).toContain('empty schema.prisma');
    expect(r.tables).toEqual([]);
  });
});
