'use strict';

/**
 * Action executor.
 *
 * Executes an array of action steps against a Playwright Page. Supports the
 * same step shape used by `meta.pages[].actions` and `journeys.yaml` steps:
 *
 *   { click, fill, wait_for, wait_ms, screenshot, screenshot_id }
 *
 * All failures are captured per-step into the `errors[]` result array rather
 * than thrown — documentation runs prioritise progress over strict failure
 * semantics. A per-step timeout keeps a hung selector from stalling the
 * pipeline.
 *
 * The `screenshotFn` hook is called whenever a step sets `screenshot: true`;
 * the orchestrator supplies a closure that writes the PNG into the right
 * manifest slot. Keeping I/O out of this module makes it pure and testable.
 */

const DEFAULT_STEP_TIMEOUT_MS = 10000;

/**
 * @typedef {{ click?: string, fill?: Record<string, string>,
 *             wait_for?: string, wait_ms?: number,
 *             screenshot?: boolean, screenshot_id?: string,
 *             dismiss?: string[] }} ActionStep
 */

/**
 * @typedef {{ step: number, message: string, stage: string }} ActionError
 */

/**
 * Execute one step.
 *
 * @param {import('playwright').Page} page
 * @param {ActionStep} step
 * @param {{ timeoutMs: number, screenshotFn?: (id: string|null) => Promise<void>,
 *           dismissFn?: (selectors: string[]) => Promise<void> }} ctx
 * @returns {Promise<{ screenshots: string[], errors: ActionError[] }>}
 */
async function executeStep(page, step, ctx, stepIndex) {
  const screenshots = [];
  const errors = [];

  const wrap = async (stage, fn) => {
    try {
      await fn();
    } catch (err) {
      errors.push({ step: stepIndex, stage, message: err && err.message ? err.message : String(err) });
    }
  };

  if (step.dismiss && step.dismiss.length > 0 && ctx.dismissFn) {
    await wrap('dismiss', () => ctx.dismissFn(step.dismiss));
  }

  if (step.click) {
    await wrap('click', () => page.click(step.click, { timeout: ctx.timeoutMs }));
  }

  if (step.fill) {
    for (const [selector, value] of Object.entries(step.fill)) {
      await wrap('fill', () => page.fill(selector, String(value), { timeout: ctx.timeoutMs }));
    }
  }

  if (step.wait_for) {
    await wrap('wait_for', () => page.waitForSelector(step.wait_for, { timeout: ctx.timeoutMs }));
  }

  if (step.wait_ms && step.wait_ms > 0) {
    await wrap('wait_ms', () => page.waitForTimeout(step.wait_ms));
  }

  if (step.screenshot && ctx.screenshotFn) {
    const id = step.screenshot_id || null;
    await wrap('screenshot', async () => {
      await ctx.screenshotFn(id);
      screenshots.push(id || `step_${stepIndex}`);
    });
  }

  return { screenshots, errors };
}

/**
 * Execute a full sequence.
 *
 * @param {import('playwright').Page} page
 * @param {ActionStep[]} steps
 * @param {{ timeoutMs?: number, screenshotFn?: (id: string|null) => Promise<void>,
 *           dismissFn?: (selectors: string[]) => Promise<void> }} [opts]
 * @returns {Promise<{ screenshots: string[], errors: ActionError[] }>}
 */
async function executeActions(page, steps, opts = {}) {
  const ctx = {
    timeoutMs: opts.timeoutMs || DEFAULT_STEP_TIMEOUT_MS,
    screenshotFn: opts.screenshotFn,
    dismissFn: opts.dismissFn,
  };
  const screenshots = [];
  const errors = [];
  if (!Array.isArray(steps) || steps.length === 0) {
    return { screenshots, errors };
  }
  for (let i = 0; i < steps.length; i++) {
    const result = await executeStep(page, steps[i], ctx, i + 1);
    screenshots.push(...result.screenshots);
    errors.push(...result.errors);
  }
  return { screenshots, errors };
}

module.exports = {
  executeActions,
  executeStep,
  DEFAULT_STEP_TIMEOUT_MS,
};
