'use strict';

/**
 * Roles-section expander input.
 *
 * Builds a per-role Doc-Model subtree for the `<!-- GEN:roles-section -->`
 * directive used in user-guide templates. The previous v0.3 templates
 * hardcoded two role blocks ("Обычный пользователь", "Администратор") with
 * literal `{role}` placeholders that leaked into the rendered Markdown when
 * the template's AGENT-comment got parsed incorrectly. This replaces both
 * problems:
 *
 *   1. Roles iterated from `meta.auth.roles[]` — arbitrary count / naming.
 *   2. Human-readable labels mapped from slug, with a fallback table that
 *      covers the most common GOST-style roles (guest, user, admin,
 *      moderator, operator, editor, …).
 *   3. Activity + function descriptions sourced from role-discovery
 *      research when available; otherwise a placeholder paragraph marks
 *      the gap so empty-section guard and md-lint surface it.
 *
 * Pure function: the caller provides meta, research text, and language.
 */

const LABELS = {
  ru: {
    guest:       { label: 'Неавторизованный посетитель' },
    user:        { label: 'Пользователь' },
    admin:       { label: 'Администратор' },
    superadmin:  { label: 'Суперадминистратор' },
    moderator:   { label: 'Модератор' },
    operator:    { label: 'Оператор' },
    editor:      { label: 'Редактор' },
    organizer:   { label: 'Организатор' },
    manager:     { label: 'Менеджер' },
    viewer:      { label: 'Просмотр' },
  },
  en: {
    guest:       { label: 'Anonymous visitor' },
    user:        { label: 'User' },
    admin:       { label: 'Administrator' },
    superadmin:  { label: 'Super-Administrator' },
    moderator:   { label: 'Moderator' },
    operator:    { label: 'Operator' },
    editor:      { label: 'Editor' },
    organizer:   { label: 'Organiser' },
    manager:     { label: 'Manager' },
    viewer:      { label: 'Viewer' },
  },
};

const STRINGS = {
  ru: {
    activities_heading:  'Виды деятельности',
    functions_heading:   'Доступные функции',
    restrictions_heading: 'Ограничения',
    placeholder_activities: '_(Перечень видов деятельности для этой роли подлежит уточнению — исследование ролей не вернуло данных.)_',
    placeholder_functions:  '_(Перечень доступных функций для этой роли подлежит уточнению.)_',
  },
  en: {
    activities_heading:  'Activities',
    functions_heading:   'Available functions',
    restrictions_heading: 'Restrictions',
    placeholder_activities: '_(Activities for this role are to be confirmed — role research returned no data.)_',
    placeholder_functions:  '_(Available functions for this role are to be confirmed.)_',
  },
};

function capitalise(slug) {
  if (!slug) return '';
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/[-_]/g, ' ');
}

function labelFor(roleSlug, lang) {
  const known = LABELS[lang] && LABELS[lang][roleSlug];
  if (known) return known.label;
  return capitalise(roleSlug);
}

/**
 * Parse the "Роль | Источник | Комментарий" table from role-discovery.md
 * to pull a short human-readable description for each role slug. The
 * markdown table layout is stable across projects because it is emitted
 * by the role-discovery subagent contract.
 *
 * @param {string} researchMd
 * @returns {Map<string, { description: string }>}
 */
function parseRoleDiscoveryTable(researchMd) {
  const out = new Map();
  if (!researchMd || typeof researchMd !== 'string') return out;
  const lines = researchMd.split('\n');
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (/^\|\s*Роль\s*\|/.test(trimmed) || /^\|\s*Role\s*\|/i.test(trimmed)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return out;
  const sepIdx = headerIdx + 1;
  if (sepIdx >= lines.length || !/^\|[\s:|-]+\|$/.test(lines[sepIdx].trim())) return out;
  for (let i = sepIdx + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed.startsWith('|')) break;
    const cells = trimmed.slice(1, -1).split('|').map((c) => c.trim());
    if (cells.length < 3) continue;
    const [role, , comment] = cells;
    if (role && comment) out.set(role.toLowerCase(), { description: comment });
  }
  return out;
}

/**
 * Build an array of Doc-Model subsections, one per configured role.
 *
 * @param {{ auth?: { roles?: Array<{ role: string }> } }} meta
 * @param {string} researchMd — role-discovery.md content, may be empty
 * @param {{ lang?: 'ru'|'en', headingLevel?: number }} [opts]
 * @returns {Array<object>} — sections ready to append via template-loader
 *                            (returned under `{ kind: 'section', section }`
 *                            by the generate.js expander).
 */
function findInRoleModel(roleModel, slug) {
  if (!Array.isArray(roleModel) || !slug) return null;
  const target = String(slug).toLowerCase();
  return roleModel.find((e) => e && e.role && String(e.role).toLowerCase() === target) || null;
}

function bulletList(items) {
  const lines = items.filter(Boolean).map((text) => `- ${String(text).replace(/\n+/g, ' ').trim()}`);
  return { type: 'raw', format: 'markdown', content: lines.join('\n') + '\n' };
}

/**
 * @param {{ auth?: { roles?: Array<{ role: string }> } }} meta
 * @param {string} researchMd
 * @param {{ lang?: 'ru'|'en', headingLevel?: number,
 *            roleModel?: Array<object>|null }} [opts]
 */
function buildRolesSections(meta, researchMd, opts = {}) {
  const lang = opts.lang === 'en' ? 'en' : 'ru';
  const level = Number(opts.headingLevel) > 0 ? Number(opts.headingLevel) : 3;
  const roles = (meta && meta.auth && Array.isArray(meta.auth.roles)) ? meta.auth.roles : [];
  const discovery = parseRoleDiscoveryTable(researchMd);
  const strings = STRINGS[lang];
  const roleModel = Array.isArray(opts.roleModel) ? opts.roleModel : null;

  const sections = [];
  for (const roleCfg of roles) {
    const slug = roleCfg && roleCfg.role ? String(roleCfg.role) : null;
    if (!slug) continue;
    if (slug === 'guest-only') continue;
    const heading = labelFor(slug, lang);
    const discovered = discovery.get(slug.toLowerCase());
    const structured = findInRoleModel(roleModel, slug);
    const elements = [];

    if (structured) {
      // Structured path: agent emitted role_model with activities / functions /
      // limits arrays. We render each list as a proper bullet list instead of
      // the old "placeholder paragraph" format, and mark empty lists with a
      // TODO admonition so the gap is visible.
      if (structured.label) {
        elements.push({ type: 'paragraph', text: `**${structured.label}.**` });
      } else if (discovered && discovered.description) {
        elements.push({ type: 'paragraph', text: discovered.description });
      }
      const triples = [
        ['activities', strings.activities_heading, strings.placeholder_activities],
        ['functions',  strings.functions_heading,  strings.placeholder_functions],
      ];
      for (const [key, title, placeholder] of triples) {
        const items = Array.isArray(structured[key]) ? structured[key].filter(Boolean) : [];
        elements.push({ type: 'paragraph', text: `**${title}:**` });
        if (items.length === 0) {
          elements.push({ type: 'admonition', kind: 'todo', text: placeholder.replace(/^_\(|\)_$/g, '') });
        } else {
          elements.push(bulletList(items));
        }
      }
      if (Array.isArray(structured.limits) && structured.limits.length > 0) {
        elements.push({ type: 'paragraph', text: `**${lang === 'en' ? 'Role limits' : 'Ограничения роли'}:**` });
        elements.push(bulletList(structured.limits));
      }
    } else {
      // Fallback: legacy discovery-from-markdown path.
      if (discovered && discovered.description) {
        elements.push({ type: 'paragraph', text: discovered.description });
      }
      elements.push({ type: 'paragraph', text: `**${strings.activities_heading}.** ${strings.placeholder_activities}` });
      elements.push({ type: 'paragraph', text: `**${strings.functions_heading}.** ${strings.placeholder_functions}` });
    }

    sections.push({
      heading,
      level,
      slug: `role-${slug}`,
      elements,
      children: [],
    });
  }
  return sections;
}

module.exports = {
  buildRolesSections,
  parseRoleDiscoveryTable,
  labelFor,
  LABELS,
  STRINGS,
};
