const openai = require('../skills/gostdocs/scripts/adapters/vision/openai');

function mockResponse({ status = 200, body = '' } = {}) {
  return {
    status,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
  };
}

function validEnvelope(content) {
  return JSON.stringify({
    choices: [{ message: { content } }],
  });
}

describe('encodeImage + detectMime', () => {
  test('png extension', () => {
    expect(openai.detectMime('x.png')).toBe('image/png');
    expect(openai.detectMime('x.jpg')).toBe('image/jpeg');
    expect(openai.detectMime('x.webp')).toBe('image/webp');
  });

  test('encodes buffer to data URL', () => {
    const url = openai.encodeImage(() => Buffer.from([0xde, 0xad]), 'x.png');
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.endsWith(Buffer.from([0xde, 0xad]).toString('base64'))).toBe(true);
  });
});

describe('buildPayload', () => {
  test('wraps prompt + image in chat completion payload', () => {
    const p = openai.buildPayload('hello', 'data:image/png;base64,xxx', { model: 'm' });
    expect(p.model).toBe('m');
    expect(p.messages[0].content[0].text).toBe('hello');
    expect(p.messages[0].content[1].image_url.url).toBe('data:image/png;base64,xxx');
    expect(p.response_format.type).toBe('json_object');
  });

  test('jsonMode=false removes response_format', () => {
    const p = openai.buildPayload('x', 'data:image/png;base64,y', { jsonMode: false });
    expect(p.response_format).toBeUndefined();
  });
});

describe('inspect', () => {
  const baseOpts = {
    apiKey: 'sk-test',
    readFile: () => Buffer.from([0x01]),
  };

  test('returns parsed JSON on success', async () => {
    const body = validEnvelope('{"title":"Home","breadcrumb":[],"top_buttons":[],"filters":[],"modals_visible":[],"is_login_form":false,"is_error_page":false,"is_empty_state":false,"layout":null,"component_kind_notes":null,"table":null}');
    const fetchImpl = jest.fn(async () => mockResponse({ status: 200, body }));
    const result = await openai.inspect('/tmp/x.png', 'prompt', { ...baseOpts, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.parsed.title).toBe('Home');
  });

  test('parses JSON wrapped in fenced block', async () => {
    const body = validEnvelope('```json\n{"title":"Wrapped"}\n```');
    const fetchImpl = jest.fn(async () => mockResponse({ status: 200, body }));
    const result = await openai.inspect('/tmp/x.png', 'prompt', { ...baseOpts, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.parsed.title).toBe('Wrapped');
  });

  test('HTTP error returns status + error', async () => {
    const fetchImpl = jest.fn(async () => mockResponse({ status: 429, body: 'rate limited' }));
    const result = await openai.inspect('/tmp/x.png', 'prompt', { ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.error).toMatch(/HTTP 429/);
  });

  test('unparseable content returns ok=false with parsed=null', async () => {
    const body = validEnvelope('no json at all');
    const fetchImpl = jest.fn(async () => mockResponse({ status: 200, body }));
    const result = await openai.inspect('/tmp/x.png', 'prompt', { ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.parsed).toBeNull();
  });

  test('missing API key returns error without calling fetch', async () => {
    const fetchImpl = jest.fn();
    const result = await openai.inspect('/tmp/x.png', 'prompt', { readFile: () => Buffer.from([]), fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.error).toMatch(/OPENAI_API_KEY/);
  });

  test('fetch throws is captured', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('boom'); });
    const result = await openai.inspect('/tmp/x.png', 'p', { ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('boom');
  });

  test('readFile throws is captured', async () => {
    const fetchImpl = jest.fn();
    const result = await openai.inspect('/tmp/x.png', 'p', {
      apiKey: 'k', fetchImpl, readFile: () => { throw new Error('nope'); },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nope/);
  });
});
