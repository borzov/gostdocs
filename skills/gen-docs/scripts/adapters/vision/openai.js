'use strict';

/**
 * OpenAI gpt-4o vision adapter.
 *
 * Posts a user message with a prompt + image_url (base64) to
 * https://api.openai.com/v1/chat/completions and returns both the raw
 * response body and the parsed JSON from `inspection-schema.extractJson`.
 *
 * The API key is read from `process.env.OPENAI_API_KEY` by default; pass
 * `opts.apiKey` to override without touching the environment (used by
 * tests). The key is never logged — error messages only reference the
 * HTTP status.
 *
 * Pure in the sense that `inspect(pngPath, prompt, { fetchImpl, readFile })`
 * can be tested without network or disk.
 */

const fs = require('fs');
const path = require('path');

const inspectionSchema = require('../../lib/inspection-schema');

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_TIMEOUT_MS = 60000;

function detectMime(pngPath) {
  const ext = path.extname(pngPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'image/png';
}

function encodeImage(readFile, pngPath) {
  const buf = readFile(pngPath);
  const mime = detectMime(pngPath);
  const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf).toString('base64');
  return `data:${mime};base64,${b64}`;
}

function buildMessages(prompt, dataUrl) {
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    },
  ];
}

function buildPayload(prompt, dataUrl, opts) {
  return {
    model: opts.model || DEFAULT_MODEL,
    messages: buildMessages(prompt, dataUrl),
    max_tokens: opts.maxTokens || 1500,
    temperature: opts.temperature ?? 0,
    response_format: opts.jsonMode === false ? undefined : { type: 'json_object' },
  };
}

/**
 * Inspect a single PNG.
 *
 * @param {string} pngPath
 * @param {string} prompt
 * @param {{
 *   apiKey?: string,
 *   endpoint?: string,
 *   model?: string,
 *   maxTokens?: number,
 *   temperature?: number,
 *   jsonMode?: boolean,
 *   timeoutMs?: number,
 *   fetchImpl?: typeof fetch,
 *   readFile?: (p: string) => Buffer,
 * }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, raw: string|null, parsed: object|null, error: string|null }>}
 */
async function inspect(pngPath, prompt, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch not available; run on Node >= 18.17 or provide fetchImpl');
  }
  const apiKey = opts.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      ok: false, status: 0, raw: null, parsed: null,
      error: 'OPENAI_API_KEY is not set (export it or pass opts.apiKey)',
    };
  }
  const readFile = opts.readFile || ((p) => fs.readFileSync(p));
  let dataUrl;
  try {
    dataUrl = encodeImage(readFile, pngPath);
  } catch (err) {
    return { ok: false, status: 0, raw: null, parsed: null, error: `failed to read ${pngPath}: ${err.message}` };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(opts.endpoint || DEFAULT_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildPayload(prompt, dataUrl, opts)),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, status: 0, raw: null, parsed: null, error: err.message };
  }
  clearTimeout(timer);

  const status = response.status;
  const body = await (response.text ? response.text() : Promise.resolve(''));
  if (status < 200 || status >= 300) {
    return {
      ok: false, status, raw: body, parsed: null,
      error: `OpenAI returned HTTP ${status}`,
    };
  }

  let raw = null;
  try {
    const json = JSON.parse(body);
    raw = json.choices && json.choices[0] && json.choices[0].message
      ? json.choices[0].message.content
      : null;
  } catch {
    return { ok: false, status, raw: body, parsed: null, error: 'invalid JSON envelope from OpenAI' };
  }

  const parsed = inspectionSchema.extractJson(raw || '');
  return { ok: parsed !== null, status, raw, parsed, error: parsed === null ? 'could not extract JSON from vision response' : null };
}

module.exports = {
  inspect,
  buildMessages,
  buildPayload,
  encodeImage,
  detectMime,
  DEFAULT_ENDPOINT,
  DEFAULT_MODEL,
};
