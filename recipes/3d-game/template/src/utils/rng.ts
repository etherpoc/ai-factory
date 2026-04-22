/**
 * Linear congruential generator — deterministic, seed-driven.
 * Use instead of Math.random() for reproducible gameplay in tests.
 */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function getGameSeed(): number {
  const w = window as unknown as Record<string, unknown>;
  const raw = w['__uafSeed'];
  return typeof raw === 'number' ? raw : 42;
}
