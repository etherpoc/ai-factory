/**
 * `spec-wizard` — Phase 7.8.2 driver for the spec phase.
 *
 * Orchestrates the dialogue between the user and the interviewer agent:
 *   1. Build an `ask_user` tool backed by @inquirer/prompts.
 *   2. Construct the interviewer agent with that tool wired in.
 *   3. Invoke it once; it asks 3-7 questions and writes spec.md.
 *   4. Display the spec to the user and gate on a y/N/e approval prompt.
 *
 * Skipped entirely when `--spec-file <path>` is provided — the file is
 * copied verbatim to the workspace and treated as already approved.
 *
 * Phase 7.8.9: the `e` (edit) action now forks into two sub-actions:
 *   e1. interactive revise — interviewer reruns in REVISE mode with the
 *       user's free-text instruction; only the affected sections change
 *   e2. open in $EDITOR — unchanged legacy flow
 * Revise iterations are capped at 5 (R4 circuit breaker).
 */
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger, Recipe, Tool } from '../../core/types.js';
import type { AgentStrategy } from '../../core/agent-factory.js';
import type { MetricsRecorder } from '../../core/metrics.js';
import {
  createInterviewerAgent,
  reviseSpecViaInterviewer,
} from '../../agents/interviewer/index.js';
import { writeFileTool } from '../../core/tools/index.js';
import {
  createAskUserTool,
  type AskUserPrompter,
} from '../../core/tools/ask-user.js';
import { colors } from '../ui/colors.js';
import { UafError } from '../ui/errors.js';
import { defaultPrompter, withAbortHandling, type Prompter } from './prompts.js';
import { openInEditor, resolveEditor } from '../utils/editor.js';

/** Maximum number of interactive revise iterations (R4 circuit breaker). */
export const MAX_REVISIONS = 5;

export interface SpecWizardOptions {
  request: string;
  workspaceDir: string;
  projectId: string;
  recipe: Recipe;
  strategy: AgentStrategy;
  metrics: MetricsRecorder;
  repoRoot: string;

  /** Use a pre-existing spec file instead of running the dialogue. */
  specFile?: string;

  /**
   * Tool prompter for the LLM-driven Q&A. Defaults to the inquirer-backed
   * implementation. Tests inject a stub.
   */
  askUserPrompter?: AskUserPrompter;

  /** y/N approval prompter. Defaults to defaultPrompter(). */
  approvalPrompter?: Prompter;

  /** Skip the y/N approval step (used by --yes / CI). */
  autoApprove?: boolean;

  /** Editor for the `e` (edit) option. Defaults to $EDITOR / vi / notepad. */
  editor?: string;

  logger?: Logger;
}

export interface SpecWizardResult {
  /** Absolute path to the saved spec.md. */
  specPath: string;
  /** How many ask_user invocations happened (0 when --spec-file was used). */
  dialogTurns: number;
  /** True iff the user OK'd the spec (always true for --spec-file). */
  userApproved: boolean;
  /** How many interactive revise iterations ran (0 if none). */
  revisionCount: number;
}

const SPEC_FILENAME = 'spec.md';

export async function runSpecWizard(opts: SpecWizardOptions): Promise<SpecWizardResult> {
  const specPath = join(opts.workspaceDir, SPEC_FILENAME);

  // ---- Branch 1: --spec-file (non-interactive)
  if (opts.specFile) {
    await copyFile(opts.specFile, specPath);
    opts.logger?.info('spec-wizard: copied external spec file', {
      from: opts.specFile,
      to: specPath,
    });
    return { specPath, dialogTurns: 0, userApproved: true, revisionCount: 0 };
  }

  // ---- Branch 2: interactive dialogue
  const prompter = opts.askUserPrompter ?? (await defaultAskUserPrompter());
  let turns = 0;
  const askUserTool = createAskUserTool({
    prompter: {
      async select(o) {
        turns += 1;
        return prompter.select(o);
      },
      async input(o) {
        turns += 1;
        return prompter.input(o);
      },
    },
  });

  const toolRegistry: ReadonlyMap<string, Tool> = new Map([
    [askUserTool.name, askUserTool],
    // write_file is a builtin but we register it explicitly so the
    // interviewer's prompt directives stay self-contained.
    [writeFileTool.name, writeFileTool],
  ]);

  const interviewer = await createInterviewerAgent({
    recipe: opts.recipe,
    metrics: opts.metrics,
    repoRoot: opts.repoRoot,
    strategy: opts.strategy,
    toolRegistry,
  });

  printIntro(opts.request);
  await interviewer.invoke({
    projectId: opts.projectId,
    workspaceDir: opts.workspaceDir,
    request: opts.request,
    recipe: opts.recipe,
    artifacts: {},
  });

  // The interviewer must have written spec.md via write_file. If it didn't,
  // that's a contract violation — fail loudly so the user can see what went
  // wrong rather than silently producing an empty project.
  let spec: string;
  try {
    spec = await readFile(specPath, 'utf8');
  } catch {
    throw new UafError('interviewer did not produce spec.md', {
      code: 'RUNTIME_FAILURE',
      hint: 'Re-run with --verbose to inspect the LLM transcript, or use --spec-file <path>.',
    });
  }
  if (spec.trim().length === 0) {
    throw new UafError('interviewer produced an empty spec.md', {
      code: 'RUNTIME_FAILURE',
      hint: 'Re-run with --verbose, or use --spec-file <path>.',
    });
  }

  if (opts.autoApprove) {
    return { specPath, dialogTurns: turns, userApproved: true, revisionCount: 0 };
  }

  // ---- Approval loop (y / N / e)
  const approver = opts.approvalPrompter ?? (await defaultPrompter());
  let revisions = 0;
  for (;;) {
    printSpec(spec);
    const canRevise = revisions < MAX_REVISIONS;
    type Action = 'y' | 'n' | 'e';
    const choices: Array<{ name: string; value: Action }> = [
      { name: 'はい — この仕様で実装に進む', value: 'y' },
      { name: 'いいえ — 中断する', value: 'n' },
      {
        name: canRevise
          ? '編集する — 対話で修正 / エディタで開く'
          : '編集する — エディタで開く（対話修正は上限到達）',
        value: 'e',
      },
    ];
    const action = await withAbortHandling(() =>
      approver.select<Action>({
        message: 'この仕様で進めて良いですか?',
        choices,
        default: 'y',
      }),
    );
    if (action === 'y') {
      return {
        specPath,
        dialogTurns: turns,
        userApproved: true,
        revisionCount: revisions,
      };
    }
    if (action === 'n') {
      throw new UafError('user rejected the spec', {
        code: 'USER_ABORT',
        hint: 'Re-run `uaf create` and answer the questions differently.',
      });
    }

    // --- e branch ---
    // If we're still under the revise limit, let the user pick between
    // interactive-revise and editor. Past the limit, fall through to
    // editor only (keeps the emergency escape open).
    let editMode: 'interactive' | 'editor';
    if (canRevise) {
      editMode = await withAbortHandling(() =>
        approver.select<'interactive' | 'editor'>({
          message: '修正方法を選択してください',
          choices: [
            {
              name: '対話で修正（自由に指示を書く）',
              value: 'interactive',
            },
            {
              name: `エディタで直接編集（${resolveEditor(opts.editor)}）`,
              value: 'editor',
            },
          ],
          default: 'interactive',
        }),
      );
    } else {
      process.stderr.write(
        colors.yellow(
          `対話修正は ${MAX_REVISIONS} 回の上限に到達しました。エディタで開きます。\n`,
        ),
      );
      editMode = 'editor';
    }

    if (editMode === 'interactive') {
      // Interactive revise via interviewer in REVISE mode.
      const instruction = await withAbortHandling(() =>
        approver.input({
          message:
            '何を修正しますか? (例: "難易度を10秒ごとに20%アップに" / "敵を3種類に増やす")',
        }),
      );
      if (instruction.trim().length === 0) {
        process.stderr.write(colors.dim('修正指示が空でした。やり直します。\n'));
        continue;
      }
      revisions += 1;
      process.stderr.write(
        colors.dim(
          `interviewer (revise ${revisions}/${MAX_REVISIONS}) に修正を依頼しています…\n`,
        ),
      );
      try {
        await reviseSpecViaInterviewer({
          recipe: opts.recipe,
          metrics: opts.metrics,
          repoRoot: opts.repoRoot,
          strategy: opts.strategy,
          toolRegistry,
          projectId: opts.projectId,
          workspaceDir: opts.workspaceDir,
          currentSpec: spec,
          revisionRequest: instruction,
        });
      } catch (err) {
        // Don't kill the whole wizard on a revise failure — let the user
        // pick a different action (retry, editor, or abort).
        process.stderr.write(
          colors.yellow(
            `revise failed: ${err instanceof Error ? err.message : String(err)}\n`,
          ),
        );
        continue;
      }
      try {
        spec = await readFile(specPath, 'utf8');
      } catch {
        throw new UafError('revise did not leave a readable spec.md', {
          code: 'RUNTIME_FAILURE',
          hint: 'The interviewer should overwrite spec.md via write_file. Re-run with --verbose.',
        });
      }
      if (spec.trim().length === 0) {
        throw new UafError('revise produced an empty spec.md', {
          code: 'RUNTIME_FAILURE',
          hint: 'Re-run with --verbose to inspect the LLM transcript.',
        });
      }
      continue;
    }

    // editMode === 'editor' — existing $EDITOR flow (unchanged).
    const editorCmd = resolveEditor(opts.editor);
    process.stderr.write(colors.dim(`opening ${specPath} in ${editorCmd}…\n`));
    try {
      await openInEditor(editorCmd, specPath);
    } catch (err) {
      process.stderr.write(
        colors.yellow(
          `editor failed: ${err instanceof Error ? err.message : String(err)}\n`,
        ),
      );
    }
    spec = await readFile(specPath, 'utf8');
  }
}

// ---------------------------------------------------------------------------
// Default prompter — wraps @inquirer/prompts for the ask_user tool.
// ---------------------------------------------------------------------------

const FREE_INPUT_SENTINEL = '__uaf_free_input__';

export async function defaultAskUserPrompter(): Promise<AskUserPrompter> {
  const inquirer = await import('@inquirer/prompts');
  return {
    async select(o) {
      const choices = o.options.map((opt, idx) => ({ name: opt, value: String(idx) }));
      if (o.allowCustom) {
        choices.push({ name: '自由入力 (free text)', value: FREE_INPUT_SENTINEL });
      }
      const choice = await inquirer.select<string>({
        message: o.question,
        choices,
      });
      if (choice === FREE_INPUT_SENTINEL) {
        const free = await inquirer.input({ message: '回答を入力してください:' });
        return { answer: free, selectedIndex: -1 };
      }
      const idx = Number.parseInt(choice, 10);
      return { answer: o.options[idx]!, selectedIndex: idx };
    },
    async input(o) {
      const ans = await inquirer.input({
        message: o.question,
        ...(o.placeholder ? { default: o.placeholder } : {}),
      });
      return ans;
    },
  };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

function printIntro(request: string): void {
  process.stderr.write(
    colors.bold('--- spec phase ---') +
      '\n' +
      `request: ${request}\n` +
      colors.dim('数問の確認に答えると、仕様書 (spec.md) を作って実装に進みます。\n') +
      '\n',
  );
}

function printSpec(spec: string): void {
  process.stderr.write(
    '\n' +
      colors.bold('--- spec.md preview ---') +
      '\n' +
      spec +
      (spec.endsWith('\n') ? '' : '\n') +
      colors.bold('--- end of preview ---') +
      '\n\n',
  );
}
