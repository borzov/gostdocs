'use strict';

/**
 * Render the "test accounts" table for the deployment-guide document.
 *
 * Each row lists one role, its human-readable label, the login URL, the
 * username / email, and the password. Because `meta.yaml` is already
 * `.gitignore`-d by convention (it always stores credentials) this helper
 * does not double-encrypt anything — it just presents the values in a
 * table. The caller must decide whether the produced DOCX is safe to
 * distribute; the `include_passwords` attribute on the directive lets the
 * author opt out and emit a redacted ("●●●●●●●●") column instead.
 *
 * The renderer is stack-agnostic: it consumes `meta.auth.roles[]` which
 * is already mandated for every project, and `meta.auth.api_login.url`
 * (falling back to `meta.app.url + /login`) for the login link.
 */

const rolesLib = require('./roles-section');

const STRINGS = {
  ru: {
    caption: 'Тестовые учётные записи',
    cols: ['Роль', 'Наименование', 'URL входа', 'Логин', 'Пароль'],
    no_roles: 'В `meta.auth.roles` не определены учётные записи с парой login/password. Добавьте их вручную или запустите сидирование тестовых данных.',
    redacted: '●●●●●●●●',
  },
  en: {
    caption: 'Test accounts',
    cols: ['Role', 'Label', 'Login URL', 'Username', 'Password'],
    no_roles: 'No login/password pairs declared in `meta.auth.roles`. Add them manually or run the seeder.',
    redacted: '●●●●●●●●',
  },
};

function pickLang(lang) {
  return lang === 'en' ? 'en' : 'ru';
}

function asAbsoluteUrl(appUrl, pathOrUrl) {
  if (!pathOrUrl) return null;
  try {
    // Already an absolute URL — use as-is.
    return new URL(pathOrUrl).toString();
  } catch {
    /* fall through and treat as relative */
  }
  try {
    return new URL(pathOrUrl, appUrl).toString();
  } catch {
    return pathOrUrl;
  }
}

function deriveLoginUrl(meta, role) {
  const appUrl = meta && meta.app && meta.app.url;
  // meta.yaml v0.3 role schema uses `login_url`; older / vendor-specific
  // configs sometimes carry `login_form_url`. Try both in that order.
  const rolePath = role && (role.login_url || role.login_form_url);
  if (rolePath) return asAbsoluteUrl(appUrl, rolePath);
  if (meta && meta.auth && meta.auth.api_login && meta.auth.api_login.url) {
    return asAbsoluteUrl(appUrl, meta.auth.api_login.url);
  }
  if (appUrl) return asAbsoluteUrl(appUrl, '/login');
  return null;
}

function deriveLabel(roleSlug, lang) {
  return rolesLib.labelFor ? rolesLib.labelFor(roleSlug, lang) : roleSlug;
}

/**
 * Build the Doc-Model `table` element for `GEN:test-accounts`.
 *
 * @param {{
 *   meta?: object,
 * }} ctx
 * @param {{
 *   lang?: 'ru'|'en',
 *   includePasswords?: boolean,
 *   redactedMark?: string,
 * }} [opts]
 * @returns {Array<object>}
 */
function buildTestAccounts(ctx = {}, opts = {}) {
  const t = STRINGS[pickLang(opts.lang)];
  const includePasswords = opts.includePasswords !== false;
  const redactedMark = opts.redactedMark || t.redacted;
  const meta = ctx.meta || {};
  const roles = (meta.auth && Array.isArray(meta.auth.roles)) ? meta.auth.roles : [];
  const rows = [];

  for (const role of roles) {
    if (!role || !role.role || role.role === 'guest' || role.role === 'guest-only') continue;
    // meta.yaml v0.3 stores credentials as flat fields on the role
    // (role.username / role.password). A legacy nested `credentials: { … }`
    // object is still accepted so fixtures and older meta files keep working.
    const creds = role.credentials && typeof role.credentials === 'object' ? role.credentials : {};
    const username = role.username || creds.username || creds.email || creds.login || null;
    const passwordRaw = role.password || creds.password || creds.secret || null;
    if (!username && !passwordRaw) continue;
    const loginUrl = deriveLoginUrl(meta, role) || '—';
    const password = passwordRaw
      ? (includePasswords ? passwordRaw : redactedMark)
      : '—';
    rows.push([
      String(role.role),
      deriveLabel(role.role, opts.lang),
      loginUrl,
      username || '—',
      password,
    ]);
  }

  if (rows.length === 0) {
    return [{ type: 'admonition', kind: 'todo', text: t.no_roles }];
  }

  return [{
    type: 'table',
    caption: t.caption,
    headers: t.cols,
    rows,
  }];
}

module.exports = {
  buildTestAccounts,
  deriveLoginUrl,
  STRINGS,
};
