/**
 * Image-provider registry. `asset-generator` picks one of these based on the
 * spec's `provider` field (or falls back to the default for `auto`).
 */
import type { ImageProvider } from '../types.js';
import { createReplicateProvider } from './replicate.js';

export { createReplicateProvider };

export interface ImageProviderRegistry {
  get(name: string): ImageProvider | undefined;
  list(): readonly ImageProvider[];
  /** Pick the provider for a spec where `provider` is 'auto' or unset. */
  pickDefault(): ImageProvider | undefined;
}

export function createImageProviderRegistry(providers: ImageProvider[]): ImageProviderRegistry {
  const byName = new Map(providers.map((p) => [p.name, p]));
  return {
    get: (name) => byName.get(name),
    list: () => [...byName.values()],
    pickDefault: () => providers[0],
  };
}
