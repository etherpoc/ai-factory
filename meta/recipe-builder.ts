/**
 * Recipe Builder — meta agent that clones `recipes/_template/` into a tmp dir,
 * invokes Claude with scoped file tools to specialize it, validates the result,
 * and atomically renames tmp → `recipes/<type>/` on success.
 *
 * Phase 5 implementation. See FINDINGS.md "recipe-builder ロールバック方針" for
 * the atomic-rename rationale (approach a).
 */
import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlock,
  Message,
  MessageParam,
  TextBlock,
  Tool as SdkToolDef,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import { cp, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { nullLogger } from '../core/logger.js';
import { RecipeSchema } from '../core/recipe-loader.js';
import { resolveTools } from '../core/tools/index.js';
import type { Logger, ToolContext, Tool, Recipe } from '../core/types.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_ROUNDS = 30;
const MAX_OUTPUT_TOKENS = 8000;

export interface BuildRecipeOptions {
  /** kebab-case recipe type name (e.g. "cli", "3d-game"). */
  type: string;
  /** Natural-language description of the stack to build. */
  description: string;
  /** Repo root (defaults to cwd). */
  repoRoot?: string;
  /** Override the Anthropic client (tests). */
  client?: Anthropic;
  /** Override the model. Defaults to Sonnet 4.6. */
  model?: string;
  /** Custom tool-use prompt (tests). If omitted, reads `meta/recipe-builder-prompt.md`. */
  roleInstructions?: string;
  /** Custom preamble. If omitted, reads `agents/_common-preamble.md` (for prompt caching). */
  preamble?: string;
  /** Cap on tool-use rounds. Defaults to 30; lower values are useful for tests. */
  maxToolRounds?: number;
  /**
   * Name of an existing recipe the LLM should treat as a structural template
   * (e.g. `referenceType: '2d-game'` when building `3d-game`). The LLM is
   * instructed in the user message to `cat recipes/<reference>/...` before
   * writing. Does nothing beyond adding a hint to the prompt.
   */
  referenceType?: string;
  /**
   * Tests only: skip the Phase C self-verification evidence check (install /
   * build / test bash invocations). Production runs MUST NOT pass this.
   */
  skipSelfVerificationCheck?: boolean;
  /** Hook for per-call observability. */
  onRawUsage?: (ev: { round: number; usage: unknown; stopReason: string | null }) => void;
  onToolCall?: (ev: { tool: string; ok: boolean; durationMs: number; args: string }) => void;
  logger?: Logger;
}

export interface BuildRecipeResult {
  type: string;
  recipePath: string;
  tmpPath: string;
  validated: true;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  model: string;
  toolCalls: number;
  finalText: string;
}

export class RecipeBuildError extends Error {
  constructor(
    message: string,
    public readonly tmpPath: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = 'RecipeBuildError';
  }
}

const TYPE_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
const RESERVED = new Set(['_template', '.tmp']);

export function validateRecipeType(type: string): void {
  if (!TYPE_PATTERN.test(type)) {
    throw new RecipeBuildError(
      `invalid type "${type}" — must be kebab-case (a-z, 0-9, -), start/end alphanumeric`,
      '',
    );
  }
  if (RESERVED.has(type)) {
    throw new RecipeBuildError(`type "${type}" is reserved`, '');
  }
}

/**
 * Build a new recipe. Returns once `recipes/<type>/` exists and passes schema
 * validation. On any failure, the tmp dir is removed and no `recipes/<type>/`
 * side effect occurs.
 */
export async function buildRecipe(opts: BuildRecipeOptions): Promise<BuildRecipeResult> {
  validateRecipeType(opts.type);
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const logger = opts.logger ?? nullLogger;

  const finalPath = join(repoRoot, 'recipes', opts.type);
  if (await pathExists(finalPath)) {
    throw new RecipeBuildError(`recipes/${opts.type} already exists`, '');
  }
  const templatePath = join(repoRoot, 'recipes', '_template');
  if (!(await pathExists(templatePath))) {
    throw new RecipeBuildError('recipes/_template is missing; cannot clone', '');
  }

  const tmpPath = join(repoRoot, 'recipes', '.tmp', `${opts.type}-${Date.now()}`);
  await mkdir(dirname(tmpPath), { recursive: true });
  await cp(templatePath, tmpPath, { recursive: true });
  logger.info('recipe-builder: tmp initialized', { tmpPath });

  try {
    const rolePrompt =
      opts.roleInstructions ??
      (await readFileSafely(join(repoRoot, 'meta', 'recipe-builder-prompt.md')));
    const preamble =
      opts.preamble ?? (await readFileSafely(join(repoRoot, 'agents', '_common-preamble.md')));

    const { usage, toolCalls, finalText, model, bashLog } = await runLlmLoop(opts, tmpPath, {
      rolePrompt,
      preamble,
    });

    // Validation (structural + verification evidence)
    await validateBuiltRecipe(tmpPath, opts.type, repoRoot, {
      ...(opts.skipSelfVerificationCheck ? {} : { bashLog, finalText }),
    });

    // Atomic move
    await mkdir(dirname(finalPath), { recursive: true });
    await rename(tmpPath, finalPath);
    logger.info('recipe-builder: recipe committed', { finalPath });

    return {
      type: opts.type,
      recipePath: finalPath,
      tmpPath,
      validated: true,
      usage,
      model,
      toolCalls,
      finalText,
    };
  } catch (err) {
    logger.warn('recipe-builder: cleaning up tmp after failure', {
      tmpPath,
      error: err instanceof Error ? err.message : String(err),
    });
    await rm(tmpPath, { recursive: true, force: true }).catch((cleanupErr) =>
      logger.error('recipe-builder: cleanup itself failed', {
        error: String(cleanupErr),
      }),
    );
    if (err instanceof RecipeBuildError) throw err;
    throw new RecipeBuildError(err instanceof Error ? err.message : String(err), tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface BashCallLog {
  command: string;
  ok: boolean;
}

export interface VerificationOptions {
  /** bash tool invocations captured during the LLM loop (for Phase C evidence check). */
  bashLog?: BashCallLog[];
  /** Final LLM text output (for detecting explicit `SKIP(<reason>)` annotations). */
  finalText?: string;
}

export async function validateBuiltRecipe(
  tmpPath: string,
  expectedType: string,
  repoRoot: string,
  verification: VerificationOptions = {},
): Promise<void> {
  const yamlPath = join(tmpPath, 'recipe.yaml');
  if (!(await pathExists(yamlPath))) {
    throw new RecipeBuildError('recipe.yaml is missing in output', tmpPath);
  }
  const raw = await readFile(yamlPath, 'utf8');
  const doc = parseDocument(raw, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new RecipeBuildError(
      'recipe.yaml failed to parse',
      tmpPath,
      doc.errors.map((e) => e.message),
    );
  }
  const parsed = RecipeSchema.safeParse(doc.toJS({ mapAsMap: false }));
  if (!parsed.success) {
    throw new RecipeBuildError(
      'recipe.yaml failed schema validation',
      tmpPath,
      parsed.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`),
    );
  }
  const recipe = parsed.data as unknown as Recipe;
  if (recipe.meta.type !== expectedType) {
    throw new RecipeBuildError(
      `recipe.yaml meta.type "${recipe.meta.type}" does not match requested type "${expectedType}"`,
      tmpPath,
    );
  }
  if (recipe.scaffold.type === 'template') {
    const scaffoldDir = join(tmpPath, recipe.scaffold.path);
    if (!(await pathExists(scaffoldDir))) {
      throw new RecipeBuildError(
        `scaffold directory "${recipe.scaffold.path}" does not exist`,
        tmpPath,
      );
    }
    const pkg = join(scaffoldDir, 'package.json');
    if (!(await pathExists(pkg))) {
      throw new RecipeBuildError('scaffold template is missing package.json', tmpPath);
    }
  }
  // Soft check: README.md should exist at the recipe root
  if (!(await pathExists(join(tmpPath, 'README.md')))) {
    throw new RecipeBuildError('README.md is missing at the recipe root (R1)', tmpPath);
  }
  // Guard F1: build / test commands must include --ignore-workspace
  if (!recipe.build.command.includes('--ignore-workspace')) {
    throw new RecipeBuildError('build.command must include --ignore-workspace (F1)', tmpPath, [
      recipe.build.command,
    ]);
  }
  if (!recipe.test.command.includes('--ignore-workspace')) {
    throw new RecipeBuildError('test.command must include --ignore-workspace (F1)', tmpPath, [
      recipe.test.command,
    ]);
  }
  // Guard (Phase 5 follow-up): build / test commands must install dependencies first,
  // otherwise the scaffold — which ships without node_modules — will fail at "binary not found".
  if (!hasInstallStep(recipe.build.command)) {
    throw new RecipeBuildError(
      'build.command must include `pnpm install` or `npm install` (scaffold has no node_modules)',
      tmpPath,
      [recipe.build.command],
    );
  }
  if (!hasInstallStep(recipe.test.command)) {
    throw new RecipeBuildError(
      'test.command must include `pnpm install` or `npm install`',
      tmpPath,
      [recipe.test.command],
    );
  }

  // P1 (F19): recipe-level README.md must have been updated from the _template stub.
  const recipeReadmeBytes = await readFile(join(tmpPath, 'README.md'));
  const templateReadmePath = join(repoRoot, 'recipes', '_template', 'README.md');
  if (await pathExists(templateReadmePath)) {
    const templateReadmeBytes = await readFile(templateReadmePath);
    if (recipeReadmeBytes.equals(templateReadmeBytes)) {
      throw new RecipeBuildError(
        'recipe README.md is byte-identical to _template/README.md (stub was not updated)',
        tmpPath,
      );
    }
  }
  const readmeText = recipeReadmeBytes.toString('utf8');
  if (!readmeText.toLowerCase().includes(expectedType.toLowerCase())) {
    throw new RecipeBuildError(
      `recipe README.md does not mention the recipe type "${expectedType}" anywhere`,
      tmpPath,
    );
  }

  // P0 (F19): self-verification evidence from the LLM's bash invocations.
  // If the caller supplied a bashLog we enforce that install/build/test were actually run.
  if (verification.bashLog) {
    const evidence = extractVerificationEvidence(
      verification.bashLog,
      recipe,
      verification.finalText ?? '',
    );
    const issues: string[] = [];
    if (!evidence.installOk) {
      issues.push(
        '`pnpm install` (or npm/yarn install) was not observed to succeed in any bash tool call',
      );
    }
    if (!evidence.buildOk && !evidence.buildSkippedWithReason) {
      issues.push(
        `build command did not successfully run in the tmp dir (looked for: ${JSON.stringify(evidence.buildMarker)})`,
      );
    }
    if (!evidence.testOk && !evidence.testSkippedWithReason) {
      issues.push(
        `test command did not successfully run (looked for: ${JSON.stringify(evidence.testMarker)}), nor was an explicit SKIP(reason) present in the final summary`,
      );
    }
    if (issues.length > 0) {
      throw new RecipeBuildError(
        'self-verification (Phase C) is required but evidence is incomplete — see details',
        tmpPath,
        issues,
      );
    }
  }
}

function hasInstallStep(command: string): boolean {
  return /\b(?:pnpm|npm|yarn)\s+(?:[a-z-]+\s+)*install\b/.test(command);
}

/**
 * Reduce the bash tool log to boolean verification flags.
 *
 * - `installOk`: any successful bash call containing `pnpm install` / `npm install` / `yarn install`
 * - `buildOk`: any successful bash call whose command string contains the **final** step of `recipe.build.command`
 * - `testOk`: same for `recipe.test.command`
 *
 * An explicit `build: SKIP(<reason>)` / `test: SKIP(<reason>)` line in the final LLM text
 * satisfies the corresponding check (for stacks where the builder cannot be run locally,
 * e.g. Android emulator needed).
 */
export function extractVerificationEvidence(
  bashLog: BashCallLog[],
  recipe: Recipe,
  finalText: string,
): {
  installOk: boolean;
  buildOk: boolean;
  testOk: boolean;
  buildMarker: string;
  testMarker: string;
  buildSkippedWithReason: boolean;
  testSkippedWithReason: boolean;
} {
  const installOk = bashLog.some(
    (b) => b.ok && /\b(?:pnpm|npm|yarn)\s+(?:[a-z-]+\s+)*install\b/.test(b.command),
  );
  const buildMarker = lastCommandSegment(recipe.build.command);
  const testMarker = lastCommandSegment(recipe.test.command);
  const buildOk = bashLog.some((b) => b.ok && b.command.includes(buildMarker));
  const testOk = bashLog.some((b) => b.ok && b.command.includes(testMarker));
  const buildSkippedWithReason = /\bbuild\s*:\s*SKIP\s*\(.+\)/i.test(finalText);
  const testSkippedWithReason = /\btest\s*:\s*SKIP\s*\(.+\)/i.test(finalText);
  return {
    installOk,
    buildOk,
    testOk,
    buildMarker,
    testMarker,
    buildSkippedWithReason,
    testSkippedWithReason,
  };
}

/** Extract the last `&&`-separated segment and take the command line itself (no args piping). */
function lastCommandSegment(fullCommand: string): string {
  const parts = fullCommand
    .split('&&')
    .map((s) => s.trim())
    .filter(Boolean);
  const last = parts[parts.length - 1] ?? fullCommand;
  // Strip `pnpm --ignore-workspace exec ` / `npx ` prefixes so the marker is the actual tool name.
  return last
    .replace(/^pnpm\s+(?:--[a-z-]+\s+)*exec\s+/, '')
    .replace(/^npx\s+/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// LLM tool-use loop
// ---------------------------------------------------------------------------

interface LlmLoopResult {
  usage: BuildRecipeResult['usage'];
  toolCalls: number;
  finalText: string;
  model: string;
  bashLog: BashCallLog[];
}

async function runLlmLoop(
  opts: BuildRecipeOptions,
  tmpPath: string,
  prompts: { rolePrompt: string; preamble: string },
): Promise<LlmLoopResult> {
  const client = opts.client ?? new Anthropic();
  const model = opts.model ?? DEFAULT_MODEL;
  const logger = opts.logger ?? nullLogger;

  // Full tool set for recipe builder: needs reads, writes, edits, and list_dir.
  // Scoped to tmpPath via ToolContext.
  const tools = resolveTools('programmer'); // same set: read_file, list_dir, write_file, edit_file, bash
  const toolsByName = new Map(tools.map((t) => [t.name, t]));
  const sdkTools: SdkToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as SdkToolDef['input_schema'],
  }));

  const toolCtx: ToolContext = { workspaceDir: tmpPath, projectId: opts.type, logger };

  const system: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
  if (prompts.preamble.trim()) {
    system.push({
      type: 'text',
      text: prompts.preamble,
      cache_control: { type: 'ephemeral' },
    });
  }
  system.push({ type: 'text', text: prompts.rolePrompt });

  const userMessageLines = [
    `# 新しいレシピを作って`,
    ``,
    `- type: **${opts.type}**`,
    `- description: ${opts.description}`,
    `- workspaceDir: ${tmpPath}`,
  ];
  if (opts.referenceType) {
    userMessageLines.push(`- **reference: ${opts.referenceType}**`);
    userMessageLines.push(
      `  → この種別は \`recipes/${opts.referenceType}/\` と構造的に類似している。書き始める前に必ず \`bash('cat recipes/${opts.referenceType}/recipe.yaml')\` と \`bash('ls recipes/${opts.referenceType}/template')\` で既存レシピを読み込み、その骨格を **写経してから** 該当部分を ${opts.type} 向けに置き換えること。`,
    );
  }
  userMessageLines.push(``);
  userMessageLines.push(
    `すでに recipes/_template/ の内容が workspaceDir にコピーされている。これを ${opts.type} 種別に特化した完動レシピに書き換えて。`,
  );
  const userMessage = userMessageLines.join('\n');

  const messages: MessageParam[] = [{ role: 'user', content: userMessage }];

  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  let toolCalls = 0;
  let finalText = '';
  const bashLog: BashCallLog[] = [];

  const maxRounds = opts.maxToolRounds ?? MAX_TOOL_ROUNDS;
  for (let round = 0; round < maxRounds; round++) {
    const response: Message = await client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
      tools: sdkTools,
    });

    usage.inputTokens += response.usage.input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens ?? 0;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cacheCreationTokens += response.usage.cache_creation_input_tokens ?? 0;

    opts.onRawUsage?.({ round, usage: response.usage, stopReason: response.stop_reason });

    if (response.stop_reason !== 'tool_use') {
      finalText = extractText(response);
      break;
    }

    const toolUses = response.content.filter(isToolUseBlock);
    if (toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        const impl = toolsByName.get(tu.name);
        const args = (typeof tu.input === 'object' && tu.input !== null ? tu.input : {}) as Record<
          string,
          unknown
        >;
        const argsSummary = summarizeToolArgs(tu.name, args);
        toolCalls += 1;
        if (!impl) {
          opts.onToolCall?.({ tool: tu.name, ok: false, durationMs: 0, args: argsSummary });
          return {
            type: 'tool_result' as const,
            tool_use_id: tu.id,
            content: `unknown tool: ${tu.name}`,
            is_error: true,
          };
        }
        const start = Date.now();
        const result = await impl.run(args, toolCtx);
        const durationMs = Date.now() - start;
        opts.onToolCall?.({ tool: tu.name, ok: result.ok, durationMs, args: argsSummary });
        if (tu.name === 'bash') {
          bashLog.push({ command: String(args.command ?? ''), ok: result.ok });
        }
        return result.ok
          ? {
              type: 'tool_result' as const,
              tool_use_id: tu.id,
              content:
                typeof result.output === 'string'
                  ? truncate(result.output, 40_000)
                  : truncate(JSON.stringify(result.output), 40_000),
            }
          : {
              type: 'tool_result' as const,
              tool_use_id: tu.id,
              content: result.error,
              is_error: true,
            };
      }),
    );

    messages.push({ role: 'user', content: results });
  }

  return { usage, toolCalls, finalText, model, bashLog };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isToolUseBlock(b: ContentBlock): b is ToolUseBlock {
  return b.type === 'tool_use';
}

function extractText(msg: Message): string {
  return msg.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

function summarizeToolArgs(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
    case 'list_dir':
      return String(args.path ?? '');
    case 'write_file':
      return `${String(args.path ?? '')} (${String(args.content ?? '').length} chars)`;
    case 'edit_file':
      return `${String(args.path ?? '')} (edit)`;
    case 'bash':
      return truncate(String(args.command ?? ''), 80);
    default:
      return truncate(JSON.stringify(args), 80);
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

async function readFileSafely(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    throw err;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

// Keep `Tool` type imported for downstream type wiring
export type { Tool };
