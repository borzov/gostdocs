const pgDump = require('../skills/gostdocs/scripts/adapters/schema/pg-dump');

describe('parseSchemaDump', () => {
  test('parses CREATE TABLE with columns and defaults', () => {
    const dump = `
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    name character varying(255),
    created_at timestamp with time zone DEFAULT now()
);
`;
    const r = pgDump.parseSchemaDump(dump);
    expect(r.tables).toHaveLength(1);
    const users = r.tables[0];
    expect(users.name).toBe('users');
    const email = users.columns.find((c) => c.name === 'email');
    expect(email.nullable).toBe(false);
    const name = users.columns.find((c) => c.name === 'name');
    expect(name.nullable).toBe(true);
    const createdAt = users.columns.find((c) => c.name === 'created_at');
    expect(createdAt.default).toMatch(/now\(\)/);
  });

  test('marks primary key columns', () => {
    const dump = `
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255)
);

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
`;
    const r = pgDump.parseSchemaDump(dump);
    const id = r.tables[0].columns.find((c) => c.name === 'id');
    expect(id.primary).toBe(true);
    expect(id.nullable).toBe(false);
  });

  test('captures FOREIGN KEY with ON DELETE', () => {
    const dump = `
CREATE TABLE public.posts (
    id integer NOT NULL,
    author_id integer NOT NULL
);

ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;
`;
    const r = pgDump.parseSchemaDump(dump);
    const posts = r.tables.find((t) => t.name === 'posts');
    expect(posts.foreign_keys).toHaveLength(1);
    expect(posts.foreign_keys[0]).toMatchObject({
      columns: ['author_id'],
      references_table: 'users',
      references_columns: ['id'],
      on_delete: 'CASCADE',
    });
  });

  test('captures indexes', () => {
    const dump = `
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying
);

CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email);
CREATE INDEX users_name_idx ON public.users USING btree (name);
`;
    const r = pgDump.parseSchemaDump(dump);
    const users = r.tables[0];
    expect(users.indexes).toHaveLength(2);
    const uniq = users.indexes.find((i) => i.unique);
    expect(uniq.name).toBe('users_email_idx');
  });

  test('empty dump yields warning', () => {
    const r = pgDump.parseSchemaDump('');
    expect(r.warnings).toContain('empty pg_dump output');
    expect(r.tables).toEqual([]);
  });

  test('custom schema name', () => {
    const dump = `
CREATE TABLE app.things (
    id integer NOT NULL
);
`;
    const r = pgDump.parseSchemaDump(dump, { schema: 'app' });
    expect(r.tables).toHaveLength(1);
    expect(r.tables[0].name).toBe('things');
  });
});

describe('runPgDump (no binary available)', () => {
  test('returns warning when binary fails to launch', async () => {
    const r = await pgDump.runPgDump({ pgDumpPath: '/nonexistent/pg_dump-xyz' });
    expect(r.tables).toEqual([]);
    expect(r.warnings.some((w) => /pg_dump/.test(w))).toBe(true);
  });
});
