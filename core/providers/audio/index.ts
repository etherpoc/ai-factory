/**
 * Audio-provider registry.
 */
import type { AudioProvider } from '../types.js';
import { createElevenLabsProvider } from './elevenlabs.js';

export { createElevenLabsProvider };

export interface AudioProviderRegistry {
  get(name: string): AudioProvider | undefined;
  list(): readonly AudioProvider[];
  pickDefault(): AudioProvider | undefined;
}

export function createAudioProviderRegistry(providers: AudioProvider[]): AudioProviderRegistry {
  const byName = new Map(providers.map((p) => [p.name, p]));
  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()],
    pickDefault: () => providers[0],
  };
}
