'use strict';

/**
 * Render the three GOST scaling subsections for a technical description
 * from a scaling-scan.scanScaling() result. Invoked via
 * `<!-- GEN:tech-scaling headingLevel="2" -->`.
 */

const STRINGS = {
  ru: {
    horizontal_title: 'Горизонтальное масштабирование',
    vertical_title:   'Вертикальное масштабирование',
    fault_title:      'Отказоустойчивость',
    detected:         'Обнаружено:',
    horizontal_default: 'Горизонтальное масштабирование обеспечивается за счёт запуска нескольких экземпляров приложения за балансировщиком нагрузки. Такой подход позволяет пропорционально наращивать пропускную способность при росте числа пользователей без изменения архитектуры. Конкретная стратегия (ручное увеличение реплик, автомасштабирование по нагрузке, sharding данных) выбирается на этапе подготовки к промышленной эксплуатации с учётом прогнозируемого профиля нагрузки.',
    vertical_default:   'Вертикальное масштабирование выполняется через увеличение ресурсов отдельного экземпляра: процессорного времени, оперативной памяти и дискового пространства контейнера или виртуальной машины. Этот путь уместен в качестве первой меры при локальных пиках нагрузки или когда горизонтальное масштабирование ограничено архитектурными зависимостями (например, требованием единого in-process состояния). Точные лимиты ресурсов подбираются по результатам нагрузочного тестирования и профилирования типовых операций.',
    fault_default:      'Отказоустойчивость строится на трёх уровнях. На уровне среды исполнения обеспечивается автоматический перезапуск вышедших из строя контейнеров (restart policy) и мониторинг готовности через healthcheck-пробы. На уровне приложения повторяемые операции реализуются идемпотентно, а побочные эффекты фиксируются в журнале для последующего воспроизведения. На уровне данных применяется резервное копирование и, при необходимости, репликация, настраиваемые на этапе подготовки к промышленной эксплуатации.',
    horizontal_intro: {
      compose_replicas:  'Конфигурация docker-compose содержит директиву replicas — приложение может запускаться в нескольких экземплярах.',
      k8s_hpa:           'В кластере Kubernetes используется HorizontalPodAutoscaler — масштабирование по нагрузке настроено.',
      k8s_deployment:    'Приложение упаковано как Kubernetes Deployment — допускает увеличение replicaCount.',
      k8s_statefulset:   'Компоненты с состоянием (БД / очередь) развёрнуты как StatefulSet.',
      pm2_cluster:       'Node.js-приложение запускается в cluster-режиме PM2 — нагрузка распределяется между CPU-ядрами.',
      workers:           'Найдены библиотеки фоновых очередей — тяжёлые задачи выполняются отдельными воркерами.',
    },
    vertical_intro: {
      compose_resources: 'В docker-compose заданы лимиты ресурсов для сервисов.',
      k8s_limits:        'В Kubernetes-манифестах заданы resources.limits для контейнеров.',
    },
    fault_intro: {
      healthchecks:      'В docker-compose настроены healthcheck-директивы.',
      probes:            'Kubernetes использует livenessProbe / readinessProbe для контейнеров.',
      restart_policy:    'В docker-compose задана политика автоматического перезапуска контейнеров.',
      db_read_replica:   'Настроены реплики чтения базы данных — чтение масштабируется горизонтально.',
    },
    cache_intro:         'Для снижения нагрузки на базу данных применяются инструменты кеширования:',
    lb_intro:            'Балансировка нагрузки и reverse-proxy реализованы средствами:',
  },
  en: {
    horizontal_title: 'Horizontal scaling',
    vertical_title:   'Vertical scaling',
    fault_title:      'Fault tolerance',
    detected:         'Detected:',
    horizontal_default: 'Horizontal scaling is feasible through containerisation (several application instances behind a load balancer). The specific strategy is to be confirmed during production rollout.',
    vertical_default:   'Vertical scaling is performed by adjusting container or VM resources (CPU/RAM/disk). Specific limits are to be determined during load testing.',
    fault_default:      'Fault tolerance relies on container runtime primitives (restart policy, healthcheck) and framework capabilities. Specific data redundancy measures are to be confirmed during production rollout.',
    horizontal_intro: {
      compose_replicas:  'docker-compose declares the replicas directive — the application can run as multiple instances.',
      k8s_hpa:           'The Kubernetes cluster runs a HorizontalPodAutoscaler — scaling by load is configured.',
      k8s_deployment:    'The application ships as a Kubernetes Deployment — replicaCount can be increased.',
      k8s_statefulset:   'Stateful components (DB / queues) are deployed as StatefulSets.',
      pm2_cluster:       'The Node.js app runs in PM2 cluster mode — load is spread across CPU cores.',
      workers:           'Background-queue libraries detected — heavy tasks run on dedicated workers.',
    },
    vertical_intro: {
      compose_resources: 'docker-compose declares per-service resource limits.',
      k8s_limits:        'Kubernetes manifests declare resources.limits for containers.',
    },
    fault_intro: {
      healthchecks:      'docker-compose healthcheck directives are configured.',
      probes:            'Kubernetes liveness/readiness probes are configured.',
      restart_policy:    'docker-compose restart policy is set for automatic container restart.',
      db_read_replica:   'Database read-replica hints detected — horizontal read scaling is available.',
    },
    cache_intro:         'Caching tools detected (reduce load on the primary datastore):',
    lb_intro:            'Load balancers / reverse proxies detected:',
  },
};

function pickLang(lang) { return lang === 'en' ? 'en' : 'ru'; }
function slugify(input) {
  return String(input || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'section';
}

function sectionOf(heading, level, elements) {
  return { heading, level, slug: slugify(`scaling-${heading}`), elements, children: [] };
}

function flatten(map) {
  const out = [];
  for (const v of Object.values(map || {})) out.push(...v);
  return out;
}

function collectIntros(scanMap, introMap, fallbackList) {
  const intros = [];
  for (const [k, v] of Object.entries(scanMap || {})) {
    const intro = introMap[k];
    if (intro) {
      intros.push({ type: 'paragraph', text: intro });
    } else if (Array.isArray(v) && v.length > 0) {
      fallbackList.push({ type: 'paragraph', text: `${v.join(', ')}.` });
    }
  }
  return intros;
}

function buildHorizontal(scan, t) {
  const tail = [];
  const intros = collectIntros(scan.horizontal_scaling, t.horizontal_intro, tail);
  const caches = flatten(scan.caching);
  if (caches.length > 0) {
    tail.push({ type: 'paragraph', text: `${t.cache_intro} ${caches.join(', ')}.` });
  }
  const lbs = flatten(scan.load_balancer);
  if (lbs.length > 0) {
    tail.push({ type: 'paragraph', text: `${t.lb_intro} ${lbs.join(', ')}.` });
  }
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.horizontal_default }];
  }
  return [...intros, ...tail];
}

function buildVertical(scan, t) {
  const tail = [];
  const intros = collectIntros(scan.vertical_scaling, t.vertical_intro, tail);
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.vertical_default }];
  }
  return [...intros, ...tail];
}

function buildFault(scan, t) {
  const tail = [];
  const faultIntros = collectIntros(scan.fault_tolerance, t.fault_intro, tail);
  const replicationIntros = collectIntros(scan.replication, t.fault_intro, tail);
  const intros = [...faultIntros, ...replicationIntros];
  if (intros.length === 0 && tail.length === 0) {
    return [{ type: 'paragraph', text: t.fault_default }];
  }
  return [...intros, ...tail];
}

function buildTechScaling(scan, opts = {}) {
  const t = STRINGS[pickLang(opts.lang)];
  const level = Number(opts.headingLevel) > 0 ? Number(opts.headingLevel) : 2;
  return [
    sectionOf(t.horizontal_title, level, buildHorizontal(scan, t)),
    sectionOf(t.vertical_title,   level, buildVertical(scan,   t)),
    sectionOf(t.fault_title,      level, buildFault(scan,      t)),
  ];
}

module.exports = {
  buildTechScaling,
  STRINGS,
};
