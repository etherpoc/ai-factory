/**
 * Phase 7.8.2 — `ask_user` tool unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetAskUserMutexForTests,
  createAskUserTool,
  type AskUserPrompter,
} from '../../core/tools/ask-user.js';
import { nullLogger } from '../../core/logger.js';
import type { ToolContext, ToolResult } from '../../core/types.js';

const ctx: ToolContext = { workspaceDir: '/tmp/p', projectId: 'p', logger: nullLogger };

beforeEach(() => {
  __resetAskUserMutexForTests();
});
afterEach(() => {
  __resetAskUserMutexForTests();
});

describe('createAskUserTool — multiple choice', () => {
  it('returns the selected option and its index', async () => {
    const prompter: AskUserPrompter = {
      select: vi.fn().mockResolvedValue({ answer: 'B', selectedIndex: 1 }),
      input: vi.fn(),
    };
    const tool = createAskUserTool({ prompter });
    const r = (await tool.run(
      { question: 'pick', options: ['A', 'B', 'C'] },
      ctx,
    )) as ToolResult;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toEqual({ answer: 'B', selectedIndex: 1 });
    }
    expect(prompter.select).toHaveBeenCalledWith({
      question: 'pick',
      options: ['A', 'B', 'C'],
      allowCustom: true, // defaults to true when options are present
    });
  });

  it('honors allow_custom=false', async () => {
    const prompter: AskUserPrompter = {
      select: vi.fn().mockResolvedValue({ answer: 'A', selectedIndex: 0 }),
      input: vi.fn(),
    };
    const tool = createAskUserTool({ prompter });
    await tool.run({ question: 'q', options: ['A'], allow_custom: false }, ctx);
    expect(prompter.select).toHaveBeenCalledWith({
      question: 'q',
      options: ['A'],
      allowCustom: false,
    });
  });
});

describe('createAskUserTool — free input', () => {
  it('falls through to .input when no options are given', async () => {
    const prompter: AskUserPrompter = {
      select: vi.fn(),
      input: vi.fn().mockResolvedValue('the answer'),
    };
    const tool = createAskUserTool({ prompter });
    const r = (await tool.run({ question: 'why?' }, ctx)) as ToolResult;
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toEqual({ answer: 'the answer', selectedIndex: -1 });
    }
    expect(prompter.input).toHaveBeenCalled();
  });
});

describe('createAskUserTool — validation', () => {
  it('rejects an empty / non-string question', async () => {
    const tool = createAskUserTool({
      prompter: { select: vi.fn(), input: vi.fn() },
    });
    const r1 = (await tool.run({ question: '' }, ctx)) as ToolResult;
    const r2 = (await tool.run({ question: 123 as unknown as string }, ctx)) as ToolResult;
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
  });

  it('enforces the per-invocation question cap (R4)', async () => {
    const prompter: AskUserPrompter = {
      select: vi.fn().mockResolvedValue({ answer: 'x', selectedIndex: 0 }),
      input: vi.fn().mockResolvedValue('x'),
    };
    const tool = createAskUserTool({ prompter, maxQuestions: 2 });
    expect((await tool.run({ question: 'q1' }, ctx)).ok).toBe(true);
    expect((await tool.run({ question: 'q2' }, ctx)).ok).toBe(true);
    const r3 = (await tool.run({ question: 'q3' }, ctx)) as ToolResult;
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error).toMatch(/question limit/);
  });
});

describe('createAskUserTool — concurrency mutex', () => {
  it('serialises overlapping calls', async () => {
    const events: string[] = [];
    const prompter: AskUserPrompter = {
      select: vi.fn(),
      input: vi.fn(async (o) => {
        events.push(`start:${o.question}`);
        await new Promise((r) => setTimeout(r, 30));
        events.push(`end:${o.question}`);
        return o.question;
      }),
    };
    const tool = createAskUserTool({ prompter });
    await Promise.all([
      tool.run({ question: 'a' }, ctx),
      tool.run({ question: 'b' }, ctx),
      tool.run({ question: 'c' }, ctx),
    ]);
    // Each call must complete before the next begins (no interleaving).
    expect(events).toEqual([
      'start:a',
      'end:a',
      'start:b',
      'end:b',
      'start:c',
      'end:c',
    ]);
  });
});
