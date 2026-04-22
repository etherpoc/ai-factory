/**
 * Exit code policy for the uaf CLI.
 *
 * Phase 9 will wire these into CI workflows, so every handler that fails must
 * map to one of these stable codes. Commander reserves 0–2 for itself (0 =
 * success, 2 = argument parse error), so uaf-specific failures start at 3.
 *
 * ```
 *   0  success
 *   1  generic uncategorized error
 *   2  CLI argument error (commander auto)
 *   3  NOT_IMPLEMENTED
 *   4  configuration error (invalid YAML, schema violation, missing required key)
 *   5  runtime error (budget exceeded, circuit breaker tripped, build/test failed)
 *   6  environment error (missing ANTHROPIC_API_KEY, missing pnpm, etc. — surfaced by `uaf doctor`)
 *   7  not found (project id / recipe / config key that the user referenced is missing)
 *   8  user aborted (Ctrl-C in a wizard prompt, or declined a destructive confirmation)
 * ```
 *
 * When throwing a `UafError`, pass the matching code in the `code` field — the
 * top-level handler in `cli/index.ts` uses `exitCodeFor(err)` to resolve it.
 * Handlers that need a bespoke exit code can put it in `details.exitCode`.
 */
export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC: 1,
  ARG_ERROR: 2,
  NOT_IMPLEMENTED: 3,
  CONFIG_ERROR: 4,
  RUNTIME_ERROR: 5,
  ENV_ERROR: 6,
  NOT_FOUND: 7,
  USER_ABORT: 8,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

/**
 * Map a `UafError.code` (string) to the CLI exit code. Unknown codes fall
 * through to `GENERIC` (1). Keep this a pure function so tests can lock the
 * contract down.
 */
const CODE_TO_EXIT: Record<string, ExitCode> = {
  NOT_IMPLEMENTED: EXIT_CODES.NOT_IMPLEMENTED,

  // Config
  CONFIG_INVALID: EXIT_CODES.CONFIG_ERROR,
  CONFIG_NOT_FOUND: EXIT_CODES.NOT_FOUND,
  CONFIG_WRITE_FAILED: EXIT_CODES.CONFIG_ERROR,
  CONFIG_PARSE_ERROR: EXIT_CODES.CONFIG_ERROR,

  // Runtime
  BUDGET_EXCEEDED: EXIT_CODES.RUNTIME_ERROR,
  CIRCUIT_BREAKER_TRIPPED: EXIT_CODES.RUNTIME_ERROR,
  PHASE_C_EVIDENCE_MISSING: EXIT_CODES.RUNTIME_ERROR,
  BUILD_FAILED: EXIT_CODES.RUNTIME_ERROR,
  TEST_FAILED: EXIT_CODES.RUNTIME_ERROR,
  RUNTIME_FAILURE: EXIT_CODES.RUNTIME_ERROR,
  RECIPE_BUILD_FAILED: EXIT_CODES.RUNTIME_ERROR,
  REGRESSION_PRECONDITION_FAILED: EXIT_CODES.RUNTIME_ERROR,

  // Environment
  API_KEY_MISSING: EXIT_CODES.ENV_ERROR,
  PNPM_MISSING: EXIT_CODES.ENV_ERROR,
  PLAYWRIGHT_MISSING: EXIT_CODES.ENV_ERROR,
  NODE_VERSION: EXIT_CODES.ENV_ERROR,
  DOCTOR_CHECKS_FAILED: EXIT_CODES.ENV_ERROR,

  // Not found
  PROJECT_NOT_FOUND: EXIT_CODES.NOT_FOUND,
  RECIPE_NOT_FOUND: EXIT_CODES.NOT_FOUND,
  WORKSPACE_NOT_FOUND: EXIT_CODES.NOT_FOUND,

  // User abort
  USER_ABORT: EXIT_CODES.USER_ABORT,

  // Programmer / caller bugs (empty required arg reaching the pure function)
  ARG_MISSING: EXIT_CODES.ARG_ERROR,
};

/** Resolve the exit code for a thrown value. */
export function exitCodeFor(err: unknown): ExitCode {
  if (typeof err !== 'object' || err === null) return EXIT_CODES.GENERIC;
  const e = err as {
    code?: unknown;
    details?: { exitCode?: unknown };
  };
  // 1) Explicit override in details.exitCode wins.
  if (typeof e.details?.exitCode === 'number') {
    return e.details.exitCode as ExitCode;
  }
  // 2) Known code string → mapped exit.
  if (typeof e.code === 'string' && CODE_TO_EXIT[e.code]) {
    return CODE_TO_EXIT[e.code];
  }
  // 3) Fallthrough.
  return EXIT_CODES.GENERIC;
}
