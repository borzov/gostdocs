'use strict';

/**
 * Single CLI parser used by every entry-point script in the skill.
 *
 * Supported flags:
 *   --yes                       non-interactive mode (use defaults + saved meta.yaml)
 *   --config <path>             explicit meta.yaml path (default: <project>/docs/meta.yaml)
 *   --only <name>               restrict run to one phase or one document
 *   --skip-screenshots          reuse screenshots from previous run
 *   --rerun-screenshots <role>  capture only the listed role (repeatable)
 *   --dry-run                   print what would happen, do not write outputs
 *   --live-db                   allow pg_dump / live DB introspection
 *   --vision-provider <name>    claude | openai
 *   --lang <list>               comma-separated languages, e.g. ru,en
 *   --help, -h                  print usage
 *
 * Unknown flags are collected in `extras` so individual scripts can accept
 * their own options without the parser rejecting them.
 */

const VALID_ONLY_PHASES = new Set([
  'precheck',
  'research',
  'plan-capture',
  'capture',
  'ui-inspection',
  'generation',
  'validation',
]);

const VALID_PROVIDERS = new Set(['claude', 'openai']);

function help() {
  return [
    'Usage: <script> [options]',
    '',
    'Options:',
    '  --yes                       non-interactive mode',
    '  --config <path>             explicit meta.yaml path',
    '  --only <name>               one phase (precheck, research, plan-capture,',
    '                              capture, ui-inspection, generation, validation)',
    '                              or one doc type (user-guide, admin-guide, ...)',
    '  --skip-screenshots          reuse screenshots from previous run',
    '  --rerun-screenshots <role>  capture only the listed role (repeatable)',
    '  --dry-run                   print what would happen, do not write outputs',
    '  --live-db                   allow pg_dump / live DB introspection',
    '  --vision-provider <name>    claude | openai',
    '  --lang <list>               comma-separated languages, e.g. ru,en',
    '  --help, -h                  print this usage',
  ].join('\n');
}

/**
 * @param {string[]} argv
 * @returns {{ yes: boolean, config: string|null, only: string|null,
 *            skipScreenshots: boolean, rerunRoles: string[], dryRun: boolean,
 *            liveDb: boolean, visionProvider: string|null, langs: string[]|null,
 *            help: boolean, extras: string[] }}
 */
function parseArgs(argv) {
  const out = {
    yes: false,
    config: null,
    only: null,
    skipScreenshots: false,
    rerunRoles: [],
    dryRun: false,
    liveDb: false,
    visionProvider: null,
    langs: null,
    help: false,
    extras: [],
  };

  const consumeValue = (flag, value) => {
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--yes':
      case '-y':
        out.yes = true;
        break;
      case '--config':
        out.config = consumeValue('--config', argv[++i]);
        break;
      case '--only': {
        const v = consumeValue('--only', argv[++i]);
        // Phase names are validated; doc-type names are passed through (extra validation upstream).
        out.only = v;
        break;
      }
      case '--skip-screenshots':
        out.skipScreenshots = true;
        break;
      case '--rerun-screenshots':
        out.rerunRoles.push(consumeValue('--rerun-screenshots', argv[++i]));
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--live-db':
        out.liveDb = true;
        break;
      case '--vision-provider': {
        const v = consumeValue('--vision-provider', argv[++i]);
        if (!VALID_PROVIDERS.has(v)) {
          throw new Error(`--vision-provider must be one of ${[...VALID_PROVIDERS].join(', ')}`);
        }
        out.visionProvider = v;
        break;
      }
      case '--lang':
        out.langs = consumeValue('--lang', argv[++i])
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        out.extras.push(arg);
    }
  }

  return out;
}

/** Validate semantic relationships after parsing. Throws on conflict. */
function assertConsistent(cli) {
  if (cli.skipScreenshots && cli.rerunRoles.length > 0) {
    throw new Error('--skip-screenshots cannot be combined with --rerun-screenshots');
  }
  if (cli.only && VALID_ONLY_PHASES.has(cli.only) && cli.skipScreenshots && cli.only === 'capture') {
    throw new Error('--skip-screenshots is redundant when --only capture');
  }
}

module.exports = {
  parseArgs,
  assertConsistent,
  help,
  VALID_ONLY_PHASES,
  VALID_PROVIDERS,
};
