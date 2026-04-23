/**
 * `ask_user` tool (Phase 7.8 — interviewer agent).
 *
 * Lets the interviewer agent prompt the user for input mid-conversation. The
 * tool is registered at runtime by `cli/interactive/spec-wizard.ts` (only when
 * stdin is a TTY) — agents that try to call it in a non-interactive context
 * get a clear ToolResult error and the wizard surfaces a "use --spec-file"
 * hint to the user.
 *
 * Concurrency: the strategy's tool-use loop runs same-round tool calls in
 * parallel (Promise.all). Two simultaneous prompts would corrupt readline
 * state, so a process-wide mutex serialises them. In practice the prompt
 * tells the LLM to ask one question at a time, but defence-in-depth.
 */
import type { Tool, ToolResult } from '../types.js';

/**
 * Function the tool calls to actually display the question. Injected so
 * tests can stub stdin/stdout, and so the implementation isn't pinned to
 * `@inquirer/prompts`.
 */
export interface AskUserPrompter {
  /**
   * Ask a multiple-choice question. `options` is the displayed list. If
   * `allowCustom` is true, the prompter MUST include a "(自由入力)" affordance
   * that returns `selectedIndex: -1` so the agent can distinguish.
   */
  select(opts: {
    question: string;
    options: string[];
    allowCustom: boolean;
  }): Promise<{ answer: string; selectedIndex: number }>;
  /** Ask a free-form question. */
  input(opts: { question: string; placeholder?: string }): Promise<string>;
}

export interface AskUserToolOptions {
  prompter: AskUserPrompter;
  /** Hard limit on questions per agent invocation (R4 — prevent infinite loops). */
  maxQuestions?: number;
}

interface AskUserArgs {
  question?: unknown;
  options?: unknown;
  allow_custom?: unknown;
  placeholder?: unknown;
}

let mutex: Promise<unknown> = Promise.resolve();

export function createAskUserTool(opts: AskUserToolOptions): Tool {
  const maxQuestions = opts.maxQuestions ?? 12;
  let questionCount = 0;

  return {
    name: 'ask_user',
    description:
      'Ask the user a question and wait for their answer. Use this to clarify ambiguous parts of the request before generating spec.md. Prefer multiple-choice (provide 3-4 options) when you can — it is faster for the user. Set allow_custom=true to also accept a free-text answer. Ask ONE question per call; do not batch.',
    inputSchema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description:
            'The question to display. Keep it short (1-2 lines). Use the same language as the user spoke in (ja or en).',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional multiple-choice answers (3-4 recommended). Each entry is a short label shown to the user.',
        },
        allow_custom: {
          type: 'boolean',
          description:
            'If true, the user may bypass the options list with a free-text answer. Default: true when options are provided, otherwise ignored.',
        },
        placeholder: {
          type: 'string',
          description: 'Optional placeholder text for free-form answers.',
        },
      },
      required: ['question'],
    },
    async run(rawArgs): Promise<ToolResult> {
      const args = (rawArgs ?? {}) as AskUserArgs;
      if (typeof args.question !== 'string' || args.question.trim() === '') {
        return { ok: false, error: 'ask_user: `question` must be a non-empty string' };
      }

      questionCount += 1;
      if (questionCount > maxQuestions) {
        return {
          ok: false,
          error: `ask_user: question limit (${maxQuestions}) exceeded — stop asking and write spec.md now`,
        };
      }

      // Serialise prompts so two parallel tool calls don't corrupt readline.
      const release = mutex;
      let resolveMine!: () => void;
      mutex = new Promise<void>((r) => {
        resolveMine = r;
      });
      try {
        await release;
        const optionsArr = Array.isArray(args.options)
          ? args.options.filter((o): o is string => typeof o === 'string')
          : [];
        const allowCustom =
          typeof args.allow_custom === 'boolean'
            ? args.allow_custom
            : optionsArr.length > 0; // sensible default

        if (optionsArr.length > 0) {
          const result = await opts.prompter.select({
            question: args.question,
            options: optionsArr,
            allowCustom,
          });
          return { ok: true, output: { answer: result.answer, selectedIndex: result.selectedIndex } };
        }
        const answer = await opts.prompter.input({
          question: args.question,
          ...(typeof args.placeholder === 'string' ? { placeholder: args.placeholder } : {}),
        });
        return { ok: true, output: { answer, selectedIndex: -1 } };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        resolveMine();
      }
    },
  };
}

/** For tests — reset the mutex between cases. */
export function __resetAskUserMutexForTests(): void {
  mutex = Promise.resolve();
}
