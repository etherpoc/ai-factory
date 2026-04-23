/**
 * Phase 7.8.3 — roadmap builder.
 *
 * Wraps the `roadmap-builder` LLM agent:
 *   1. Invoke the agent (it reads spec.md + writes roadmap.md via tools).
 *   2. Parse the agent's text response as the `RoadmapJson` envelope.
 *   3. Validate the schema (zod) — 8-15 tasks, unique ids, sane shape.
 *   4. Sort topologically (rejects cycles); the order in state.json is the
 *      execution order the orchestrator will follow.
 *   5. Build a `RoadmapMeta` and return it. The caller persists it via
 *      `upsertWorkspaceState`.
 *
 * The whole module is testable without an LLM by injecting a fake
 * `AgentStrategy` that returns the JSON envelope verbatim.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentInput, Logger, Recipe } from './types.js';
import type { AgentStrategy } from './agent-factory.js';
import type { MetricsRecorder } from './metrics.js';
import type { RoadmapMeta, RoadmapTask } from './state.js';
import { createRoadmapBuilderAgent } from '../agents/roadmap-builder/index.js';

// ---------------------------------------------------------------------------
// Schema for the LLM's JSON envelope
// ---------------------------------------------------------------------------

const RoadmapJsonTaskSchema = z.object({
  id: z.string().regex(/^task-\d{3,}$/, 'task id must look like task-001'),
  title: z.string().min(1).max(200),
  phase: z.string().min(1).optional(),
  dependsOn: z.array(z.string()).optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  estimatedDurationMin: z.number().nonnegative().optional(),
});

export const RoadmapJsonSchema = z.object({
  tasks: z.array(RoadmapJsonTaskSchema).min(1),
  estimatedCostUsd: z.number().nonnegative().optional(),
  estimatedDurationMin: z.number().nonnegative().optional(),
});

export type RoadmapJson = z.infer<typeof RoadmapJsonSchema>;

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

export interface BuildRoadmapOptions {
  workspaceDir: string;
  projectId: string;
  request: string;
  recipe: Recipe;
  strategy: AgentStrategy;
  metrics: MetricsRecorder;
  repoRoot: string;
  logger?: Logger;
  /** Hard upper bound on tasks. Default 20 — agent prompt aims for 8-15. */
  maxTasks?: number;
  /** Hard lower bound. Default 4. */
  minTasks?: number;
}

export interface BuildRoadmapResult {
  roadmap: RoadmapMeta;
  /** Path to the markdown file the agent wrote. */
  markdownPath: string;
  /** Raw JSON string for diagnostics / logging. */
  rawJson: string;
}

export async function buildRoadmap(opts: BuildRoadmapOptions): Promise<BuildRoadmapResult> {
  const minTasks = opts.minTasks ?? 4;
  const maxTasks = opts.maxTasks ?? 20;
  const markdownPath = join(opts.workspaceDir, 'roadmap.md');

  const agent = await createRoadmapBuilderAgent({
    recipe: opts.recipe,
    metrics: opts.metrics,
    repoRoot: opts.repoRoot,
    strategy: opts.strategy,
  });

  const input: AgentInput = {
    projectId: opts.projectId,
    workspaceDir: opts.workspaceDir,
    request: opts.request,
    recipe: opts.recipe,
    artifacts: {},
  };
  const out = await agent.invoke(input);
  const rawText = out.notes ?? '';

  const json = parseRoadmapJson(rawText);
  const validated = RoadmapJsonSchema.safeParse(json);
  if (!validated.success) {
    throw new RoadmapBuilderError(
      `roadmap-builder produced invalid JSON: ${validated.error.message}`,
      { rawText },
    );
  }

  const data = validated.data;
  if (data.tasks.length < minTasks) {
    throw new RoadmapBuilderError(
      `roadmap has too few tasks (${data.tasks.length} < ${minTasks})`,
      { rawText },
    );
  }
  if (data.tasks.length > maxTasks) {
    throw new RoadmapBuilderError(
      `roadmap has too many tasks (${data.tasks.length} > ${maxTasks})`,
      { rawText },
    );
  }

  // Verify roadmap.md was actually written.
  try {
    await readFile(markdownPath, 'utf8');
  } catch {
    throw new RoadmapBuilderError(
      'roadmap-builder did not produce roadmap.md (write_file was not called)',
      { rawText },
    );
  }

  // Validate the DAG and sort topologically.
  const sortedIds = topologicalSort(data.tasks);

  // Produce the structured roadmap (preserving sorted order).
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const tasks: RoadmapTask[] = sortedIds.map((id) => {
    const t = tasksById.get(id)!;
    return {
      id: t.id,
      title: t.title,
      status: 'pending',
      ...(t.phase ? { phase: t.phase } : {}),
      ...(t.dependsOn?.length || t.estimatedCostUsd !== undefined
        ? {
            metadata: {
              ...(t.dependsOn?.length ? { dependsOn: t.dependsOn } : {}),
              ...(t.estimatedCostUsd !== undefined ? { estimatedCostUsd: t.estimatedCostUsd } : {}),
              ...(t.estimatedDurationMin !== undefined
                ? { estimatedDurationMin: t.estimatedDurationMin }
                : {}),
            },
          }
        : {}),
    };
  });

  const roadmap: RoadmapMeta = {
    path: 'roadmap.md',
    createdAt: new Date().toISOString(),
    totalTasks: tasks.length,
    completedTasks: 0,
    tasks,
    ...(data.estimatedCostUsd !== undefined ? { estimatedCostUsd: data.estimatedCostUsd } : {}),
    ...(data.estimatedDurationMin !== undefined
      ? { estimatedDurationMin: data.estimatedDurationMin }
      : {}),
  };

  return { roadmap, markdownPath, rawJson: rawText };
}

// ---------------------------------------------------------------------------
// JSON extraction — tolerate ```json fences and prose around the envelope
// ---------------------------------------------------------------------------

export function parseRoadmapJson(text: string): unknown {
  const trimmed = text.trim();

  // 1. Strict parse — works when the agent followed instructions exactly.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }

  // 2. ```json …``` fence
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
  if (fence) {
    try {
      return JSON.parse(fence[1]!);
    } catch {
      /* fall through */
    }
  }

  // 3. First {...} object in the text.
  const obj = /\{[\s\S]*\}/.exec(trimmed);
  if (obj) {
    try {
      return JSON.parse(obj[0]);
    } catch {
      /* fall through */
    }
  }

  throw new RoadmapBuilderError('could not extract JSON from roadmap-builder response', {
    rawText: text,
  });
}

// ---------------------------------------------------------------------------
// Topological sort (Kahn) — rejects cycles + dangling refs
// ---------------------------------------------------------------------------

interface SortableTask {
  id: string;
  dependsOn?: string[] | undefined;
}

export function topologicalSort(tasks: readonly SortableTask[]): string[] {
  const ids = new Set(tasks.map((t) => t.id));
  // Reject duplicate ids.
  if (ids.size !== tasks.length) {
    throw new RoadmapBuilderError('roadmap has duplicate task ids');
  }

  // Build adjacency (edge: dep → task) and in-degree counts.
  const inDegree = new Map<string, number>(tasks.map((t) => [t.id, 0]));
  const adj = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new RoadmapBuilderError(
          `task ${t.id} depends on unknown task ${dep}`,
        );
      }
      if (dep === t.id) {
        throw new RoadmapBuilderError(`task ${t.id} depends on itself`);
      }
      adj.set(dep, [...(adj.get(dep) ?? []), t.id]);
      inDegree.set(t.id, (inDegree.get(t.id) ?? 0) + 1);
    }
  }

  // Kahn's algorithm; tie-break by original task order so the output is stable.
  const order: Record<string, number> = {};
  tasks.forEach((t, i) => {
    order[t.id] = i;
  });
  const ready = tasks.filter((t) => (inDegree.get(t.id) ?? 0) === 0).map((t) => t.id);
  ready.sort((a, b) => order[a]! - order[b]!);

  const sorted: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    sorted.push(id);
    for (const next of adj.get(id) ?? []) {
      const d = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, d);
      if (d === 0) {
        // Insert in stable position.
        const insertAt = ready.findIndex((r) => order[r]! > order[next]!);
        if (insertAt < 0) ready.push(next);
        else ready.splice(insertAt, 0, next);
      }
    }
  }

  if (sorted.length !== tasks.length) {
    throw new RoadmapBuilderError('roadmap dependency graph has a cycle');
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class RoadmapBuilderError extends Error {
  readonly rawText?: string;
  constructor(message: string, opts: { rawText?: string } = {}) {
    super(message);
    this.name = 'RoadmapBuilderError';
    if (opts.rawText !== undefined) this.rawText = opts.rawText;
  }
}
