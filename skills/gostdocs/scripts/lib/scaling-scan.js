'use strict';

/**
 * Heuristic scaling / reliability scanner.
 *
 * Mirrors scripts/lib/security-scan.js but for the "Масштабирование и
 * отказоустойчивость" section of a GOST technical description. Reads
 * docker-compose, Kubernetes manifests, pm2 config, package manifests,
 * and reverse-proxy configs to produce a structured summary of:
 *
 *   - horizontal_scaling : docker replicas, k8s HPA, pm2 cluster, workers
 *   - vertical_scaling   : container resource limits (mem/cpu)
 *   - caching            : Redis / Memcached usage
 *   - queues             : background worker frameworks
 *   - load_balancer      : nginx / traefik / caddy / AWS ALB hints
 *   - fault_tolerance    : healthchecks, restart policies, read replicas
 *
 * Pure, synchronous, no network.
 */

const fs = require('fs');
const path = require('path');

function safeRead(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
}

function loadComposeCandidates(projectPath) {
  return [
    safeRead(path.join(projectPath, 'docker-compose.yml')),
    safeRead(path.join(projectPath, 'docker-compose.yaml')),
    safeRead(path.join(projectPath, 'docker-compose.prod.yml')),
    safeRead(path.join(projectPath, 'docker-compose.override.yml')),
  ].filter(Boolean).join('\n');
}

function loadK8s(projectPath) {
  const hits = [];
  for (const dir of ['k8s', 'kubernetes', 'deploy/k8s', 'infrastructure/k8s']) {
    const abs = path.join(projectPath, dir);
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
      for (const entry of fs.readdirSync(abs)) {
        if (/\.(ya?ml)$/.test(entry)) {
          const content = safeRead(path.join(abs, entry));
          if (content) hits.push(content);
        }
      }
    } catch { /* best effort */ }
  }
  return hits.join('\n');
}

function loadPm2(projectPath) {
  return safeRead(path.join(projectPath, 'ecosystem.config.js'))
    || safeRead(path.join(projectPath, 'ecosystem.config.cjs'))
    || safeRead(path.join(projectPath, 'pm2.config.js'))
    || '';
}

function loadProxy(projectPath) {
  const nginx = safeRead(path.join(projectPath, 'nginx.conf'))
    || safeRead(path.join(projectPath, 'nginx/default.conf'))
    || safeRead(path.join(projectPath, 'docker/nginx/default.conf'))
    || '';
  const traefik = safeRead(path.join(projectPath, 'traefik.yml'))
    || safeRead(path.join(projectPath, 'traefik.toml'))
    || '';
  const caddy = safeRead(path.join(projectPath, 'Caddyfile')) || '';
  return [nginx, traefik, caddy].filter(Boolean).join('\n');
}

function readPackageJsonDeps(projectPath) {
  const pkg = safeRead(path.join(projectPath, 'package.json'));
  if (!pkg) return [];
  try {
    const obj = JSON.parse(pkg);
    return [...Object.keys(obj.dependencies || {}), ...Object.keys(obj.devDependencies || {})];
  } catch { return []; }
}

function readComposerJson(projectPath) {
  const f = safeRead(path.join(projectPath, 'composer.json'));
  if (!f) return [];
  try {
    const obj = JSON.parse(f);
    return [...Object.keys(obj.require || {}), ...Object.keys(obj['require-dev'] || {})];
  } catch { return []; }
}

function readRequirements(projectPath) {
  const f = safeRead(path.join(projectPath, 'requirements.txt'));
  if (!f) return [];
  return f.split('\n').map((l) => l.split(/[<>=!;]/)[0].trim()).filter(Boolean);
}

function collectDeps(projectPath) {
  return [
    ...readPackageJsonDeps(projectPath),
    ...readComposerJson(projectPath),
    ...readRequirements(projectPath),
  ];
}

function scanScaling(projectPath) {
  const compose = loadComposeCandidates(projectPath);
  const k8s = loadK8s(projectPath);
  const pm2 = loadPm2(projectPath);
  const proxy = loadProxy(projectPath);
  const deps = collectDeps(projectPath);

  const horizontal = {};
  if (/\breplicas:\s*\d+/i.test(compose) || /\bdeploy:\s*[\s\S]*?replicas:/i.test(compose)) {
    horizontal.compose_replicas = ['docker-compose deploy.replicas'];
  }
  if (/kind:\s*HorizontalPodAutoscaler/i.test(k8s)) horizontal.k8s_hpa = ['HorizontalPodAutoscaler'];
  if (/kind:\s*Deployment/i.test(k8s)) horizontal.k8s_deployment = ['Deployment'];
  if (/\bkind:\s*StatefulSet\b/i.test(k8s)) horizontal.k8s_statefulset = ['StatefulSet'];
  if (/\bexec_mode:\s*cluster/i.test(pm2) || /instances:\s*['"]?(?:max|\d+)/.test(pm2)) {
    horizontal.pm2_cluster = ['pm2 cluster mode'];
  }
  const workers = deps.filter((d) => /bullmq|bull|rabbit|sidekiq|celery|laravel\/horizon|hangfire|spatie\/laravel-queue|rq|dramatiq/i.test(d));
  if (workers.length > 0) horizontal.workers = [...new Set(workers)];

  const vertical = {};
  if (/\bmemory:\s*\d/i.test(compose) || /\bcpus:\s*\d/i.test(compose)) {
    vertical.compose_resources = ['compose deploy.resources.limits'];
  }
  if (/\bresources:\s*[\s\S]*?limits:/i.test(k8s)) vertical.k8s_limits = ['Deployment.resources.limits'];

  const caching = {};
  const cacheDeps = deps.filter((d) => /^redis$|ioredis|redis-py|predis|phpredis|\bmemcache/i.test(d));
  if (cacheDeps.length > 0) caching.cache = [...new Set(cacheDeps)];
  if (/\bredis\b/i.test(compose) || /\bmemcached\b/i.test(compose)) {
    caching.compose_service = ['redis/memcached service in compose'];
  }

  const fault = {};
  if (/\bhealthcheck:/i.test(compose)) fault.healthchecks = ['docker-compose healthcheck'];
  if (/\blivenessProbe:|\breadinessProbe:/i.test(k8s)) fault.probes = ['k8s liveness/readiness probes'];
  if (/restart:\s*(unless-stopped|always|on-failure)/i.test(compose)) fault.restart_policy = ['restart policy'];

  const lb = {};
  if (/\bserver\s+/.test(proxy) && /upstream\b/.test(proxy)) lb.nginx_upstream = ['nginx upstream'];
  if (/entryPoints:|loadBalancer:/i.test(proxy)) lb.traefik = ['traefik loadBalancer'];
  if (/\breverse_proxy\b/.test(proxy)) lb.caddy = ['Caddy reverse_proxy'];

  const replication = {};
  if (/\bread[_-]?replicas?\b|replicaSet|read_preference/i.test(compose + '\n' + k8s)) {
    replication.db_read_replica = ['db read replicas hint'];
  }

  return {
    horizontal_scaling: horizontal,
    vertical_scaling: vertical,
    caching,
    fault_tolerance: fault,
    load_balancer: lb,
    replication,
  };
}

module.exports = {
  scanScaling,
  loadComposeCandidates,
};
