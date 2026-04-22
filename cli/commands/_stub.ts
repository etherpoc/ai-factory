/**
 * Temporary stub used by Phase 7.1 while real command handlers are in flight.
 * Each command module exports a `runX` that delegates here until the phase
 * that owns it lands.
 */
import { UafError } from '../ui/errors.js';

export function notImplemented(name: string, phase: string): never {
  throw new UafError(`"${name}" is not implemented yet.`, {
    code: 'NOT_IMPLEMENTED',
    hint: `Planned in ${phase}. See docs/spec-phase7.md.`,
  });
}
