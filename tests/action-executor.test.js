const { executeActions, executeStep } = require('../skills/gen-docs/scripts/lib/action-executor');

function makePage(overrides = {}) {
  return {
    click: jest.fn(async () => {}),
    fill: jest.fn(async () => {}),
    waitForSelector: jest.fn(async () => {}),
    waitForTimeout: jest.fn(async () => {}),
    ...overrides,
  };
}

describe('executeStep', () => {
  test('click step calls page.click', async () => {
    const page = makePage();
    const result = await executeStep(page, { click: 'button' }, { timeoutMs: 1000 }, 1);
    expect(page.click).toHaveBeenCalledWith('button', { timeout: 1000 });
    expect(result.errors).toEqual([]);
  });

  test('fill step calls page.fill for each field', async () => {
    const page = makePage();
    await executeStep(page, { fill: { '#a': '1', '#b': '2' } }, { timeoutMs: 1000 }, 1);
    expect(page.fill).toHaveBeenCalledTimes(2);
    expect(page.fill).toHaveBeenNthCalledWith(1, '#a', '1', { timeout: 1000 });
    expect(page.fill).toHaveBeenNthCalledWith(2, '#b', '2', { timeout: 1000 });
  });

  test('wait_ms calls waitForTimeout', async () => {
    const page = makePage();
    await executeStep(page, { wait_ms: 500 }, { timeoutMs: 1000 }, 1);
    expect(page.waitForTimeout).toHaveBeenCalledWith(500);
  });

  test('screenshot triggers hook', async () => {
    const page = makePage();
    const screenshotFn = jest.fn(async () => {});
    const result = await executeStep(page, { screenshot: true, screenshot_id: 'modal' }, {
      timeoutMs: 1000, screenshotFn,
    }, 1);
    expect(screenshotFn).toHaveBeenCalledWith('modal');
    expect(result.screenshots).toEqual(['modal']);
  });

  test('dismiss triggers dismissFn', async () => {
    const page = makePage();
    const dismissFn = jest.fn(async () => {});
    await executeStep(page, { dismiss: ['.banner'] }, { timeoutMs: 1000, dismissFn }, 1);
    expect(dismissFn).toHaveBeenCalledWith(['.banner']);
  });

  test('click failure collected as error not thrown', async () => {
    const page = makePage({ click: jest.fn(async () => { throw new Error('boom'); }) });
    const result = await executeStep(page, { click: 'button' }, { timeoutMs: 1000 }, 7);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({ step: 7, stage: 'click', message: 'boom' });
  });
});

describe('executeActions', () => {
  test('runs all steps in order', async () => {
    const page = makePage();
    const result = await executeActions(page, [
      { click: '.a' },
      { fill: { '#x': 'y' } },
      { wait_for: '.done' },
    ]);
    expect(page.click).toHaveBeenCalledWith('.a', expect.anything());
    expect(page.fill).toHaveBeenCalledWith('#x', 'y', expect.anything());
    expect(page.waitForSelector).toHaveBeenCalledWith('.done', expect.anything());
    expect(result.errors).toEqual([]);
  });

  test('empty steps array short-circuits', async () => {
    const page = makePage();
    const result = await executeActions(page, []);
    expect(page.click).not.toHaveBeenCalled();
    expect(result).toEqual({ screenshots: [], errors: [] });
  });

  test('continues after one step fails', async () => {
    const page = makePage({
      click: jest.fn(async () => { throw new Error('click broke'); }),
    });
    const result = await executeActions(page, [
      { click: '.a' },
      { fill: { '#x': 'y' } },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(page.fill).toHaveBeenCalled();
  });
});
