import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ProjectSpec } from './types.js';

export interface ClassifyOptions {
  /** Directory containing the `recipes/` tree. Defaults to process.cwd(). */
  repoRoot?: string;
  /** When provided, bypass classification and just build the spec for this type. */
  typeHint?: string;
}

export class ClassifyError extends Error {
  constructor(
    message: string,
    public readonly candidates: string[] = [],
  ) {
    super(message);
    this.name = 'ClassifyError';
  }
}

/**
 * Regex → recipe type. First match wins. Tuned for the recipes this project
 * ships (`2d-game`, `web-app`, `cli`, `api`, `mobile-app`, `desktop-app`, `3d-game`).
 * Unknown-type-friendly: if the request text contains the type name directly,
 * we still fall through the `matchesTypeName()` check below.
 */
const KEYWORD_RULES: { pattern: RegExp; type: string; complexity?: ProjectSpec['complexity'] }[] = [
  { pattern: /\b3d\b|三次元|3次元/i, type: '3d-game' },
  { pattern: /ゲーム|game|シューティング|avoid|避け|アクション/i, type: '2d-game' },
  { pattern: /モバイル|iPhone|Android|react\s*native|expo|mobile/i, type: 'mobile-app' },
  { pattern: /electron|desktop|デスクトップ/i, type: 'desktop-app' },
  { pattern: /\bcli\b|コマンドライン|command\s*line|ターミナル/i, type: 'cli' },
  { pattern: /\bapi\b|rest|graphql|サーバ/i, type: 'api' },
  { pattern: /web|todo|ブログ|ダッシュボード|ランディング|next\.?js|tailwind/i, type: 'web-app' },
];

const COMPLEXITY_HINTS: { pattern: RegExp; complexity: ProjectSpec['complexity'] }[] = [
  { pattern: /シンプル|simple|ミニマル|minimal|小さ(い|な)/i, complexity: 'simple' },
  { pattern: /複雑|fancy|high\s*end|プロダクション|本格的/i, complexity: 'complex' },
];

/**
 * Heuristic classifier. Pure function — deterministic and fast. Returns null
 * if no known keyword matched any of the available recipe types.
 */
export function classifyHeuristic(
  request: string,
  availableTypes: readonly string[],
): ProjectSpec | null {
  const types = new Set(availableTypes);

  let matchedType: string | undefined;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(request) && types.has(rule.type)) {
      matchedType = rule.type;
      break;
    }
  }
  if (!matchedType) {
    matchedType = availableTypes.find((t) => matchesTypeName(request, t));
  }
  if (!matchedType) return null;

  return {
    type: matchedType,
    features: extractFeatures(request),
    complexity: inferComplexity(request),
    slug: slugify(request),
    rawRequest: request,
  };
}

/**
 * Read `<repoRoot>/recipes/*` and list every directory that has a `recipe.yaml`
 * file (excluding `_template`).
 */
export async function listAvailableTypes(repoRoot: string): Promise<string[]> {
  const root = join(resolve(repoRoot), 'recipes');
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name);

  const result: string[] = [];
  await Promise.all(
    candidates.map(async (name) => {
      try {
        const { access } = await import('node:fs/promises');
        await access(join(root, name, 'recipe.yaml'));
        result.push(name);
      } catch {
        // no recipe.yaml — skip
      }
    }),
  );
  return result.sort();
}

export async function classify(request: string, opts: ClassifyOptions = {}): Promise<ProjectSpec> {
  const repoRoot = resolve(opts.repoRoot ?? process.cwd());
  const available = await listAvailableTypes(repoRoot);

  if (opts.typeHint) {
    if (available.length > 0 && !available.includes(opts.typeHint)) {
      throw new ClassifyError(
        `typeHint "${opts.typeHint}" is not available in recipes/`,
        available,
      );
    }
    return {
      type: opts.typeHint,
      features: extractFeatures(request),
      complexity: inferComplexity(request),
      slug: slugify(request),
      rawRequest: request,
    };
  }

  const heuristic = classifyHeuristic(request, available);
  if (heuristic) return heuristic;

  throw new ClassifyError(
    `could not classify request into a known recipe type. Available: [${available.join(', ') || '(none)'}]`,
    available,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesTypeName(request: string, type: string): boolean {
  const re = new RegExp(type.replace(/-/g, '[- ]?'), 'i');
  return re.test(request);
}

function extractFeatures(request: string): string[] {
  // Strip quote marks/fillers, split on punctuation, keep chunks with >= 2 tokens
  return request
    .split(/[、。.,!?！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function inferComplexity(request: string): ProjectSpec['complexity'] {
  for (const rule of COMPLEXITY_HINTS) {
    if (rule.pattern.test(request)) return rule.complexity;
  }
  return 'medium';
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'project'
  );
}
