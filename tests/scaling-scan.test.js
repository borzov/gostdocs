'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { scanScaling } = require('../skills/gen-docs/scripts/lib/scaling-scan');

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'scaling-scan-'));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

describe('scanScaling', () => {
  test('detects compose replicas, healthcheck and restart policy', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'docker-compose.yml'), [
        'services:',
        '  web:',
        '    image: example/app',
        '    deploy:',
        '      replicas: 3',
        '      resources:',
        '        limits:',
        '          memory: 512M',
        '          cpus: "1.0"',
        '    restart: unless-stopped',
        '    healthcheck:',
        '      test: ["CMD", "curl", "-f", "http://localhost/health"]',
        '  redis:',
        '    image: redis:7',
      ].join('\n'));
      const scan = scanScaling(dir);
      expect(scan.horizontal_scaling.compose_replicas).toBeDefined();
      expect(scan.vertical_scaling.compose_resources).toBeDefined();
      expect(scan.fault_tolerance.restart_policy).toBeDefined();
      expect(scan.fault_tolerance.healthchecks).toBeDefined();
      expect(scan.caching.compose_service).toBeDefined();
    } finally { cleanup(dir); }
  });

  test('detects k8s HPA and liveness probes', () => {
    const dir = mkTmp();
    try {
      const k8sDir = path.join(dir, 'k8s');
      fs.mkdirSync(k8sDir, { recursive: true });
      fs.writeFileSync(path.join(k8sDir, 'deployment.yaml'), [
        'apiVersion: apps/v1',
        'kind: Deployment',
        'metadata: { name: web }',
        'spec:',
        '  replicas: 2',
        '  template:',
        '    spec:',
        '      containers:',
        '        - name: web',
        '          image: example/app',
        '          livenessProbe: { httpGet: { path: /health, port: 8080 } }',
        '          resources: { limits: { cpu: 500m, memory: 256Mi } }',
      ].join('\n'));
      fs.writeFileSync(path.join(k8sDir, 'hpa.yaml'), [
        'apiVersion: autoscaling/v2',
        'kind: HorizontalPodAutoscaler',
        'metadata: { name: web-hpa }',
      ].join('\n'));
      const scan = scanScaling(dir);
      expect(scan.horizontal_scaling.k8s_hpa).toBeDefined();
      expect(scan.horizontal_scaling.k8s_deployment).toBeDefined();
      expect(scan.vertical_scaling.k8s_limits).toBeDefined();
      expect(scan.fault_tolerance.probes).toBeDefined();
    } finally { cleanup(dir); }
  });

  test('detects pm2 cluster mode and background workers via deps', () => {
    const dir = mkTmp();
    try {
      fs.writeFileSync(path.join(dir, 'ecosystem.config.js'), [
        "module.exports = { apps: [{ name: 'api', script: 'server.js', instances: 'max', exec_mode: 'cluster' }] };",
      ].join('\n'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        dependencies: { bullmq: '^5.0.0', ioredis: '^5.3.0' },
      }));
      const scan = scanScaling(dir);
      expect(scan.horizontal_scaling.pm2_cluster).toBeDefined();
      expect(scan.horizontal_scaling.workers).toEqual(expect.arrayContaining(['bullmq']));
      expect(scan.caching.cache).toEqual(expect.arrayContaining(['ioredis']));
    } finally { cleanup(dir); }
  });

  test('empty project returns empty maps without crash', () => {
    const dir = mkTmp();
    try {
      const scan = scanScaling(dir);
      expect(scan.horizontal_scaling).toEqual({});
      expect(scan.vertical_scaling).toEqual({});
      expect(scan.fault_tolerance).toEqual({});
    } finally { cleanup(dir); }
  });
});
