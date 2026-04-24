'use strict';

/**
 * Per-document security recommendations.
 *
 * v0.3 requirement 9.5: every document must include recommendations scoped
 * to its target audience. This module returns a ready-made Doc-Model
 * section (heading + paragraphs + bullet checklist) for each supported
 * document type.
 *
 * Supported types:
 *   user-guide          end-user facing advice (passwords, phishing, public Wi-Fi)
 *   admin-guide         admin-panel operator advice (MFA, least privilege, audit log)
 *   operator-guide      ops / infra advice (backups, environment isolation, incident response)
 *   technical-description threat-model and technical controls (TLS, data-at-rest,
 *                         at-transit, authz model, secure defaults)
 *
 * Pure function; returns a Doc-Model section object so callers can slot
 * it into any document position.
 */

const HEADINGS = {
  'user-guide':            { ru: 'Рекомендации по информационной безопасности', en: 'Information security recommendations' },
  'admin-guide':           { ru: 'Рекомендации по информационной безопасности администратора', en: 'Administrator security recommendations' },
  'operator-guide':        { ru: 'Требования информационной безопасности оператора', en: 'Operator security requirements' },
  'technical-description': { ru: 'Модель угроз и меры защиты', en: 'Threat model and security controls' },
};

const CONTENT = {
  'user-guide': {
    ru: {
      intro: 'Следование этим рекомендациям снижает риск компрометации учётной записи и данных пользователя.',
      items: [
        { label: 'Используйте уникальный пароль длиной не менее 12 символов и менеджер паролей.' },
        { label: 'Не вводите учётные данные на страницах, где адрес не совпадает с официальным (фишинг).' },
        { label: 'Не используйте публичный Wi-Fi для входа в систему — подключайтесь через VPN или мобильный интернет.' },
        { label: 'Завершайте сеанс после окончания работы, особенно на чужих устройствах.' },
        { label: 'Не передавайте логин, пароль и одноразовые коды подтверждения другим лицам.' },
        { label: 'При подозрении на компрометацию смените пароль и уведомите администратора.' },
      ],
    },
    en: {
      intro: 'Following these guidelines reduces the risk of account and data compromise.',
      items: [
        { label: 'Use a unique password of at least 12 characters and a password manager.' },
        { label: 'Do not enter credentials on pages whose URL does not match the official one (phishing).' },
        { label: 'Avoid using public Wi-Fi for login; use a VPN or mobile data instead.' },
        { label: 'Sign out when finished, especially on shared devices.' },
        { label: 'Never share your login, password, or one-time codes with anyone.' },
        { label: 'If compromise is suspected, change the password immediately and notify an administrator.' },
      ],
    },
  },
  'admin-guide': {
    ru: {
      intro: 'Администратор несёт ответственность за конфигурацию безопасности экземпляра системы. Соблюдение рекомендаций ниже минимизирует поверхность атаки.',
      items: [
        { label: 'Обязательно включите многофакторную аутентификацию (MFA) для всех учётных записей администраторов.' },
        { label: 'Назначайте роли по принципу минимально необходимых прав (least privilege).' },
        { label: 'Ведите и регулярно просматривайте журнал аудита действий администраторов.' },
        { label: 'Меняйте сервисные ключи и токены не реже раза в 90 дней и при смене ответственного лица.' },
        { label: 'Не используйте общие служебные учётные записи — каждая учётная запись должна соответствовать физическому лицу.' },
        { label: 'Регулярно проверяйте список неактивных пользователей и отключайте их.' },
        { label: 'Храните резервные копии учётных данных в отдельном защищённом хранилище.' },
      ],
    },
    en: {
      intro: 'Administrators are responsible for configuring the security of the system instance. The recommendations below minimise the attack surface.',
      items: [
        { label: 'Enforce multi-factor authentication (MFA) for every administrator account.' },
        { label: 'Grant roles on a least-privilege basis.' },
        { label: 'Maintain and periodically review the audit log of administrator actions.' },
        { label: 'Rotate service keys and tokens at least every 90 days and on handover.' },
        { label: 'Avoid shared service accounts — every account should map to a real person.' },
        { label: 'Review the list of inactive users regularly and disable stale accounts.' },
        { label: 'Store credential backups in a separate, protected vault.' },
      ],
    },
  },
  'operator-guide': {
    ru: {
      intro: 'Оператор системы отвечает за непрерывность работы и восстановление после сбоев. Следующие требования направлены на снижение операционных рисков.',
      items: [
        { label: 'Изолируйте среды (dev / staging / prod) сетевыми политиками и разными учётными данными.' },
        { label: 'Настройте автоматическое резервное копирование не реже одного раза в сутки и проверяйте восстановление не реже раза в квартал.' },
        { label: 'Храните резервные копии вне продуктивной инфраструктуры и шифруйте их в покое.' },
        { label: 'Поддерживайте задокументированный план реагирования на инциденты и контакты ответственных.' },
        { label: 'Мониторьте системные показатели и настройте алерты на отклонения.' },
        { label: 'Планируйте обновления ПО в отдельном окне и с возможностью отката.' },
      ],
    },
    en: {
      intro: 'Operators are responsible for continuity and recovery. These requirements reduce operational risk.',
      items: [
        { label: 'Isolate environments (dev / staging / prod) via network policy and separate credentials.' },
        { label: 'Back up at least daily and verify restore procedures at least quarterly.' },
        { label: 'Store backups off the production infrastructure and encrypt them at rest.' },
        { label: 'Maintain a documented incident response plan with on-call contacts.' },
        { label: 'Monitor system metrics and alert on anomalies.' },
        { label: 'Schedule software updates in a dedicated window with a rollback plan.' },
      ],
    },
  },
  'technical-description': {
    ru: {
      intro: 'Техническое описание фиксирует меры защиты, реализованные в системе, и сценарии угроз, которые они закрывают.',
      items: [
        { label: 'Вся сетевая коммуникация ведётся по TLS не ниже версии 1.2; внутренняя связь между сервисами — также по TLS или в приватной сети.' },
        { label: 'Данные пользователей в состоянии покоя шифруются на уровне хранилища; секреты хранятся в менеджере секретов и не попадают в репозиторий.' },
        { label: 'Авторизация реализована по модели RBAC с минимально необходимым набором прав на каждую роль.' },
        { label: 'Входные данные проверяются на уровне API; параметризованные запросы защищают от SQL-инъекций.' },
        { label: 'Аудит-лог фиксирует операции изменения состояния и содержит идентификатор пользователя, время и исходный IP.' },
        { label: 'Сессии пользователей защищены cookie с флагами HttpOnly и Secure; API-токены имеют ограниченное время жизни.' },
        { label: 'Регулярно проводится обновление зависимостей и анализ уязвимостей (SAST/DAST).' },
      ],
    },
    en: {
      intro: 'The technical description fixes the security controls implemented in the system and the threats they mitigate.',
      items: [
        { label: 'All network communication uses TLS ≥ 1.2; internal service-to-service traffic runs over TLS or a private network.' },
        { label: 'User data at rest is encrypted at the storage layer; secrets live in a secrets manager and never in the repository.' },
        { label: 'Authorisation is RBAC-based with least-privilege per role.' },
        { label: 'Inputs are validated at the API boundary; parameterised queries prevent SQL injection.' },
        { label: 'The audit log captures state-changing operations with user id, timestamp, and source IP.' },
        { label: 'User sessions are protected by cookies with HttpOnly and Secure flags; API tokens have a limited lifetime.' },
        { label: 'Dependencies are updated regularly with SAST / DAST scanning in CI.' },
      ],
    },
  },
};

const VALID_DOC_TYPES = Object.keys(HEADINGS);

function selectLang(lang) {
  return String(lang || '').startsWith('en') ? 'en' : 'ru';
}

/**
 * Build a Doc-Model section describing the security recommendations.
 *
 * @param {'user-guide'|'admin-guide'|'operator-guide'|'technical-description'} docType
 * @param {{ lang?: 'ru'|'en', level?: number }} [opts]
 * @returns {{ heading: string, level: number, slug: string, elements: object[], children: any[] }}
 */
function buildSection(docType, opts = {}) {
  if (!HEADINGS[docType]) {
    throw new Error(`unknown docType "${docType}"; expected one of ${VALID_DOC_TYPES.join(', ')}`);
  }
  const lang = selectLang(opts.lang);
  const level = opts.level || 1;
  const heading = HEADINGS[docType][lang];
  const content = CONTENT[docType][lang];

  /** @type {any[]} */
  const elements = [
    { type: 'paragraph', text: content.intro },
    {
      type: 'checklist-result',
      title: lang === 'en' ? 'Recommendations' : 'Рекомендации',
      items: content.items.map((it) => ({ label: it.label, filled: false, source: null })),
    },
  ];

  return {
    heading,
    level,
    slug: `security-${docType}`,
    elements,
    children: [],
  };
}

module.exports = {
  buildSection,
  VALID_DOC_TYPES,
  HEADINGS,
  CONTENT,
};
