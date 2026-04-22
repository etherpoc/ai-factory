import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ClassifyError,
  classify,
  classifyHeuristic,
  listAvailableTypes,
} from '../../core/classifier';

describe('classifyHeuristic', () => {
  const types = ['2d-game', 'web-app', 'cli', 'mobile-app', 'api', 'desktop-app'];

  it('picks 2d-game for Japanese ゲーム requests', () => {
    const spec = classifyHeuristic('2Dの避けゲームを作って', types);
    expect(spec?.type).toBe('2d-game');
    expect(spec?.complexity).toBe('medium');
  });

  it('picks web-app for Todo/Next.js prompts', () => {
    const spec = classifyHeuristic('シンプルなTodoアプリを Next.js で作りたい', types);
    expect(spec?.type).toBe('web-app');
    expect(spec?.complexity).toBe('simple');
  });

  it('picks cli for CLI requests', () => {
    const spec = classifyHeuristic('CSVを整形するCLIを作って', types);
    expect(spec?.type).toBe('cli');
  });

  it('picks mobile-app for React Native', () => {
    const spec = classifyHeuristic('React Native Expo の簡単なアプリ', types);
    expect(spec?.type).toBe('mobile-app');
  });

  it('falls back to matching the type name directly', () => {
    const spec = classifyHeuristic('api のひな形をください', types);
    expect(spec?.type).toBe('api');
  });

  it('returns null when no rule matches and no type name appears', () => {
    expect(classifyHeuristic('よくわからない依頼', types)).toBeNull();
  });

  it('returns null when matched type is not among availableTypes', () => {
    // only api is available → ゲーム request has no fallback
    expect(classifyHeuristic('2Dの避けゲームを作って', ['api'])).toBeNull();
  });

  it('treats "シンプル" as simple complexity', () => {
    const spec = classifyHeuristic('シンプルなCLIを作って', types);
    expect(spec?.complexity).toBe('simple');
  });
});

describe('listAvailableTypes / classify', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'uaf-classify-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function addRecipe(type: string) {
    await mkdir(join(root, 'recipes', type), { recursive: true });
    await writeFile(join(root, 'recipes', type, 'recipe.yaml'), 'stub', 'utf8');
  }

  it('lists only directories with a recipe.yaml, excluding _template', async () => {
    await addRecipe('web-app');
    await addRecipe('cli');
    await mkdir(join(root, 'recipes', '_template'), { recursive: true });
    await writeFile(join(root, 'recipes', '_template', 'recipe.yaml'), 'stub', 'utf8');
    await mkdir(join(root, 'recipes', 'broken'), { recursive: true });
    const names = await listAvailableTypes(root);
    expect(names.sort()).toEqual(['cli', 'web-app']);
  });

  it('returns [] when recipes/ is missing', async () => {
    expect(await listAvailableTypes(root)).toEqual([]);
  });

  it('classify honours typeHint when type is available', async () => {
    await addRecipe('cli');
    const spec = await classify('please build anything', { repoRoot: root, typeHint: 'cli' });
    expect(spec.type).toBe('cli');
  });

  it('classify rejects a typeHint that is not in recipes/', async () => {
    await addRecipe('cli');
    await expect(classify('foo', { repoRoot: root, typeHint: 'web-app' })).rejects.toBeInstanceOf(
      ClassifyError,
    );
  });

  it('classify throws ClassifyError with candidates when heuristic fails', async () => {
    await addRecipe('web-app');
    try {
      await classify('よくわからない', { repoRoot: root });
      throw new Error('expected classify to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ClassifyError);
      expect((err as ClassifyError).candidates).toEqual(['web-app']);
    }
  });
});
