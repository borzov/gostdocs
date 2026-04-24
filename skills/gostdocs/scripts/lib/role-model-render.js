'use strict';

/**
 * Render role-model and RBAC-matrix Doc-Model fragments.
 *
 * The role-discovery subagent publishes structured data in
 * `<agent>.summary.json`:
 *   - `role_model: [{ role, label, activities, functions, limits, permissions }]`
 *   - `rbac_matrix: { domains: [...], rows: [{ role, cells: { [domain]: label } }] }`
 *
 * Two GEN directives consume those arrays:
 *   - `GEN:role-activities role="user"` → buildRoleActivities
 *   - `GEN:rbac-matrix`                 → buildRbacMatrix
 *
 * Rendering stays stack-agnostic: the input contract is language-neutral
 * (activities and labels are free-form strings filled by the agent), and the
 * output is a Doc-Model section / table that fits into existing templates.
 */

const STRINGS = {
  ru: {
    no_role_model: 'Модель ролей не была получена в ходе исследования. Добавьте данные в `_research/role-discovery.md` или заполните раздел вручную.',
    unknown_role: (role) => `Роль «${role}» не описана в role-discovery. Задайте activities/functions/limits вручную.`,
    activities_heading: 'Виды деятельности',
    functions_heading: 'Доступные функции',
    limits_heading: 'Ограничения роли',
    no_activities: 'Виды деятельности для этой роли не перечислены в исследовании.',
    no_functions: 'Перечень доступных функций не задан в исследовании.',
    no_limits: 'Границы роли не зафиксированы явно.',
    rbac_caption: 'Матрица доступа «Роль × Домен разрешений»',
    rbac_col_role: 'Роль',
    rbac_empty: 'Матрица доступа не была получена от role-discovery.',
  },
  en: {
    no_role_model: 'Role model was not produced by research. Add data to `_research/role-discovery.md` or fill this section manually.',
    unknown_role: (role) => `Role "${role}" is not described in role-discovery. Populate activities/functions/limits manually.`,
    activities_heading: 'Activities',
    functions_heading: 'Available functions',
    limits_heading: 'Role limits',
    no_activities: 'Activities for this role are not listed in research.',
    no_functions: 'Function list is not defined in research.',
    no_limits: 'Role limits are not explicitly recorded.',
    rbac_caption: 'Access matrix "Role × Permission domain"',
    rbac_col_role: 'Role',
    rbac_empty: 'RBAC matrix was not produced by role-discovery.',
  },
};

function selectLang(lang) {
  return lang && /^en/i.test(lang) ? 'en' : 'ru';
}

function findRole(roleModel, role) {
  if (!Array.isArray(roleModel) || !role) return null;
  const target = String(role).toLowerCase();
  return roleModel.find((entry) => entry && entry.role && String(entry.role).toLowerCase() === target) || null;
}

function bulletListElement(items) {
  // Emit a tight Markdown bullet list as a raw element — the doc-model-md
  // renderer treats the whole block as a paragraph boundary, which is the
  // simplest way to get a real list in DOCX without a dedicated `list`
  // element type.
  const lines = items.map((text) => `- ${String(text).replace(/\n+/g, ' ').trim()}`);
  return { type: 'raw', format: 'markdown', content: lines.join('\n') + '\n' };
}

/**
 * Build Doc-Model elements describing a single role's activities, functions,
 * and limits. If the role is absent from the model, emit a single TODO
 * admonition so the reader can see which role is missing data.
 *
 * @param {Array<object>|null} roleModel
 * @param {{ role?: string, lang?: 'ru'|'en', headingLevel?: number }} opts
 * @returns {Array<object>} Doc-Model elements
 */
function buildRoleActivities(roleModel, opts = {}) {
  const lang = selectLang(opts.lang);
  const t = STRINGS[lang];
  if (!Array.isArray(roleModel) || roleModel.length === 0) {
    return [{ type: 'admonition', kind: 'todo', text: t.no_role_model }];
  }
  const entry = findRole(roleModel, opts.role);
  if (!entry) {
    return [{ type: 'admonition', kind: 'todo', text: t.unknown_role(opts.role || '') }];
  }

  const elements = [];
  if (entry.label) {
    elements.push({ type: 'paragraph', text: `**${entry.label}.**` });
  }

  // Activities, functions, limits each become a mini paragraph + bullet list.
  // When a list is empty we surface a TODO admonition so the gap is visible.
  const sections = [
    ['activities', t.activities_heading, t.no_activities],
    ['functions',  t.functions_heading,  t.no_functions],
    ['limits',     t.limits_heading,     t.no_limits],
  ];
  for (const [key, heading, emptyText] of sections) {
    const items = Array.isArray(entry[key]) ? entry[key].filter(Boolean) : [];
    elements.push({ type: 'paragraph', text: `**${heading}:**` });
    if (items.length === 0) {
      elements.push({ type: 'admonition', kind: 'todo', text: emptyText });
    } else {
      elements.push(bulletListElement(items));
    }
  }
  return elements;
}

/**
 * Build a Doc-Model table describing the "Role × Permission domain" matrix.
 * When the matrix is absent we return a single TODO admonition rather than
 * an empty table so the reader sees WHY the section is blank.
 *
 * @param {{ domains: string[], rows: Array<{ role: string, cells: Record<string, string> }> }} matrix
 * @param {{ lang?: 'ru'|'en', roleLabels?: Record<string, string> }} [opts]
 * @returns {Array<object>} Doc-Model elements
 */
function buildRbacMatrix(matrix, opts = {}) {
  const lang = selectLang(opts.lang);
  const t = STRINGS[lang];
  if (!matrix
      || !Array.isArray(matrix.domains)
      || !Array.isArray(matrix.rows)
      || matrix.domains.length === 0
      || matrix.rows.length === 0) {
    return [{ type: 'admonition', kind: 'todo', text: t.rbac_empty }];
  }
  const roleLabels = opts.roleLabels || {};
  const headers = [t.rbac_col_role, ...matrix.domains];
  const rows = matrix.rows.map((row) => {
    const roleLabel = roleLabels[row.role] || row.role;
    const cells = matrix.domains.map((domain) => {
      const cell = row.cells && Object.prototype.hasOwnProperty.call(row.cells, domain)
        ? String(row.cells[domain])
        : '—';
      return cell;
    });
    return [roleLabel, ...cells];
  });
  return [{
    type: 'table',
    caption: t.rbac_caption,
    headers,
    rows,
  }];
}

module.exports = {
  buildRoleActivities,
  buildRbacMatrix,
  findRole,
  STRINGS,
};
