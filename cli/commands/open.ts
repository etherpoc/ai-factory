/**
 * `uaf open` — launch an editor (or browser for web-ish recipes) on a
 * workspace.
 */
import { loadEffectiveConfig, resolveWorkspaceDir } from '../config/loader.js';
import { findProject } from '../utils/workspace.js';
import { openInEditor, resolveEditor } from '../utils/editor.js';
import { colors, symbols } from '../ui/colors.js';

export interface OpenOptions {
  projectId: string;
  editor?: string;
  browser?: boolean;
}

const WEB_RECIPE_TYPES = new Set(['web-app']);

export async function runOpen(opts: OpenOptions, _global: unknown = {}): Promise<void> {
  const { effective: cfg } = await loadEffectiveConfig();
  const workspaceBase = resolveWorkspaceDir(cfg, process.cwd());
  const project = await findProject(workspaceBase, opts.projectId);

  const recipeType = project.state?.recipeType ?? '';
  const shouldOpenBrowser = opts.browser ?? false;

  if (shouldOpenBrowser && WEB_RECIPE_TYPES.has(recipeType)) {
    // Dev-server URL is recipe-dependent. For now, just direct the user.
    process.stderr.write(
      colors.yellow(`${symbols.warn} --browser: start the dev server and visit its URL manually.\n`),
    );
    process.stderr.write(`  cd ${project.dir} && pnpm dev\n`);
    return;
  }

  const editor = resolveEditor(opts.editor, cfg.editor);
  process.stderr.write(`${colors.dim(`opening ${editor} ${project.dir}`)}\n`);
  await openInEditor(editor, project.dir);
}
