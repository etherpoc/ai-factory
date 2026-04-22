/**
 * `uaf doctor` — sanity-check the local environment.
 *
 * Reads the right bits to answer questions like "why did my last run fail
 * before it even called the LLM?". No mutations — safe to run in CI.
 */
import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { colors, symbols } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';

const execAsync = promisify(exec);

export interface DoctorOptions {
  json?: boolean;
}

type Status = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  status: Status;
  message: string;
  hint?: string;
}

export async function runDoctor(opts: DoctorOptions = {}, _global: unknown = {}): Promise<void> {
  const checks: Check[] = [];

  // 1. Node version
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0]!, 10);
  checks.push({
    name: 'node >= 20',
    status: nodeMajor >= 20 ? 'ok' : 'fail',
    message: `node ${process.versions.node}`,
    ...(nodeMajor < 20 ? { hint: 'Upgrade Node.js (nvm install 20).' } : {}),
  });

  // 2. pnpm
  checks.push(await checkCommand('pnpm --version', 'pnpm'));

  // 3. Playwright (used by recipe tests; not strictly required for uaf itself)
  checks.push(await checkCommand('pnpm exec playwright --version', 'playwright', 'warn'));

  // 4. ANTHROPIC_API_KEY
  const key = process.env.ANTHROPIC_API_KEY;
  checks.push({
    name: 'ANTHROPIC_API_KEY',
    status: key ? 'ok' : 'fail',
    message: key ? `set (${key.slice(0, 12)}…)` : 'missing',
    ...(key ? {} : { hint: 'cp .env.example .env and set ANTHROPIC_API_KEY.' }),
  });

  // 4a. REPLICATE_API_TOKEN (Phase 11.a — optional external asset provider)
  const rep = process.env.REPLICATE_API_TOKEN;
  if (!rep) {
    checks.push({
      name: 'REPLICATE_API_TOKEN',
      status: 'warn',
      message: 'missing — artist agent will be skipped',
      hint: 'Needed only for recipes with agents.optional: [artist]. Get a token at https://replicate.com/account/api-tokens.',
    });
  } else {
    checks.push(await pingReplicate(rep));
  }

  // 4b. ELEVENLABS_API_KEY (Phase 11.a — optional external asset provider)
  const el = process.env.ELEVENLABS_API_KEY;
  if (!el) {
    checks.push({
      name: 'ELEVENLABS_API_KEY',
      status: 'warn',
      message: 'missing — sound agent will be skipped',
      hint: 'Needed only for recipes with agents.optional: [sound]. Get a key at https://elevenlabs.io/app/settings/api-keys.',
    });
  } else {
    checks.push(await pingElevenLabs(el));
  }

  // 5. Config validity (just try to load it — throws if the YAML is bad)
  try {
    const { effective: cfg, sources, paths } = await loadEffectiveConfig();
    checks.push({
      name: 'config loads',
      status: 'ok',
      message: [
        `global: ${sources.global ? paths.global : '(none)'}`,
        `project: ${sources.project ? paths.project : '(none)'}`,
      ].join(' · '),
    });
    // 6. Workspace writable
    const base = resolveWorkspaceDir(cfg, process.cwd());
    try {
      await access(base);
      checks.push({ name: `workspace writable`, status: 'ok', message: base });
    } catch {
      checks.push({
        name: 'workspace',
        status: 'warn',
        message: `${base} does not exist yet (will be created on first run)`,
      });
    }
  } catch (err) {
    checks.push({
      name: 'config loads',
      status: 'fail',
      message: err instanceof Error ? err.message : String(err),
      hint: 'Fix ~/.uaf/config.yaml or ./.uafrc, or delete them to regenerate defaults.',
    });
  }

  // 7. Recipes pass F19 structure check
  try {
    await execAsync('pnpm tsx scripts/check-recipes.ts', {
      cwd: process.cwd(),
      timeout: 30_000,
    });
    checks.push({ name: 'recipes (F19 check)', status: 'ok', message: 'all recipes pass' });
  } catch (err) {
    checks.push({
      name: 'recipes (F19 check)',
      status: 'fail',
      message: err instanceof Error ? err.message.slice(0, 120) : String(err),
      hint: 'Run `pnpm tsx scripts/check-recipes.ts` for the full report.',
    });
  }

  // 8. .env.example presence (sanity for first-time setup)
  try {
    await access(join(process.cwd(), '.env.example'));
    checks.push({ name: '.env.example present', status: 'ok', message: '' });
  } catch {
    checks.push({
      name: '.env.example present',
      status: 'warn',
      message: 'missing — run uaf from the repo root',
    });
  }

  // 9. Output
  if (opts.json) {
    process.stdout.write(JSON.stringify({ checks }, null, 2) + '\n');
    return;
  }

  const labels: Record<Status, string> = {
    ok: colors.green(symbols.ok + ' OK  '),
    warn: colors.yellow(symbols.warn + ' WARN'),
    fail: colors.red(symbols.fail + ' FAIL'),
  };
  for (const c of checks) {
    process.stdout.write(`${labels[c.status]}  ${c.name.padEnd(26)}${c.message ? '  ' + c.message : ''}\n`);
    if (c.hint && c.status !== 'ok') {
      process.stdout.write(`         ${colors.dim('hint: ' + c.hint)}\n`);
    }
  }
  const failed = checks.filter((c) => c.status === 'fail').length;
  if (failed > 0) {
    throw new UafError(`${failed} check(s) failed`, {
      code: 'DOCTOR_CHECKS_FAILED',
      details: { failedCount: failed },
      hint: 'Fix the items marked FAIL above, then rerun `uaf doctor`.',
    });
  }
}

async function checkCommand(cmd: string, name: string, levelOnFail: Status = 'fail'): Promise<Check> {
  try {
    const { stdout } = await execAsync(cmd, { timeout: 10_000 });
    return { name, status: 'ok', message: stdout.trim().split('\n')[0] ?? '' };
  } catch {
    return {
      name,
      status: levelOnFail,
      message: 'not found',
      hint: `\`${cmd.split(' ')[0]}\` is not on PATH.`,
    };
  }
}

// Lightweight connectivity checks. We hit cheap, safe endpoints that return
// info about the caller's account without creating billable work. Errors are
// downgraded to `warn` so a flaky provider doesn't block `uaf doctor`.

async function pingReplicate(token: string): Promise<Check> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8_000);
  try {
    const res = await fetch('https://api.replicate.com/v1/account', {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return {
        name: 'REPLICATE_API_TOKEN',
        status: 'fail',
        message: `${res.status} ${res.statusText} — token rejected`,
        hint: 'Regenerate the token at https://replicate.com/account/api-tokens.',
      };
    }
    if (!res.ok) {
      return {
        name: 'REPLICATE_API_TOKEN',
        status: 'warn',
        message: `${res.status} ${res.statusText}`,
        hint: 'Replicate API responded but not 2xx — check status.replicate.com.',
      };
    }
    return {
      name: 'REPLICATE_API_TOKEN',
      status: 'ok',
      message: `set (${token.slice(0, 6)}…) · ping OK`,
    };
  } catch (err) {
    return {
      name: 'REPLICATE_API_TOKEN',
      status: 'warn',
      message: `ping failed: ${err instanceof Error ? err.message : String(err)}`,
      hint: 'Token is set but api.replicate.com is unreachable — check network / proxy.',
    };
  } finally {
    clearTimeout(t);
  }
}

async function pingElevenLabs(key: string): Promise<Check> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15_000);
  try {
    const res = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': key },
      signal: ac.signal,
    });
    if (res.status === 401) {
      return {
        name: 'ELEVENLABS_API_KEY',
        status: 'fail',
        message: '401 — key rejected',
        hint: 'Regenerate the key at https://elevenlabs.io/app/settings/api-keys.',
      };
    }
    if (!res.ok) {
      return {
        name: 'ELEVENLABS_API_KEY',
        status: 'warn',
        message: `${res.status} ${res.statusText}`,
      };
    }
    // Surface the subscription tier if present — confirms the key matches a
    // real ElevenCreative-capable account.
    let tier = '';
    try {
      const body = (await res.json()) as { subscription?: { tier?: string } };
      if (body.subscription?.tier) tier = ` · tier ${body.subscription.tier}`;
    } catch {
      // ignore JSON shape mismatches
    }
    return {
      name: 'ELEVENLABS_API_KEY',
      status: 'ok',
      message: `set (${key.slice(0, 6)}…) · ping OK${tier}`,
    };
  } catch (err) {
    return {
      name: 'ELEVENLABS_API_KEY',
      status: 'warn',
      message: `ping failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    clearTimeout(t);
  }
}
