import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';

/** Repository path and content policy (PROJECT_REPOSITORY_DESIGN.md §10). */
export class PathPolicyError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`${reason}: ${path.slice(0, 200)}`);
    this.name = 'PathPolicyError';
  }
}

export const LIMITS = {
  textFileBytes: 512 * 1024,
  assetBytes: 5 * 1024 * 1024,
  treeBytes: 50 * 1024 * 1024,
  files: 2000,
  depth: 20,
  segmentBytes: 255,
} as const;

const WRITABLE_EXTENSIONS = new Set([
  '.tsx',
  '.ts',
  '.css',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.woff2',
  '.md',
  '.txt',
  '.html',
]);
const TEXT_EXTENSIONS = new Set(['.tsx', '.ts', '.css', '.json', '.svg', '.md', '.txt', '.html']);
const SPECIAL_FILES = new Set(['.gitignore']);

/** Returns the normalised repo-relative POSIX path or throws. Never touches the filesystem. */
export function normaliseRepoPath(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 1024)
    throw new PathPolicyError(typeof input === 'string' ? input : '', 'Invalid path');
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f\\]/.test(input)) throw new PathPolicyError(input, 'Invalid characters');
  if (input.startsWith('/')) throw new PathPolicyError(input, 'Absolute paths are not allowed');
  const segments = input.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..'))
    throw new PathPolicyError(input, 'Path segments must be non-empty and not "." or ".."');
  if (segments.length > LIMITS.depth) throw new PathPolicyError(input, 'Path too deep');
  if (segments.some((s) => Buffer.byteLength(s) > LIMITS.segmentBytes))
    throw new PathPolicyError(input, 'Name too long');
  if (segments.some((s) => s.toLowerCase() === '.git' || s.toLowerCase().startsWith('.git/')))
    throw new PathPolicyError(input, 'The .git directory is not accessible');
  if (segments[0] === 'node_modules')
    throw new PathPolicyError(input, 'node_modules is not accessible');
  return posix.normalize(input);
}

export function assertWritable(path: string, size: number): void {
  const name = posix.basename(path);
  const ext = posix.extname(name).toLowerCase();
  if (!SPECIAL_FILES.has(name) && !WRITABLE_EXTENSIONS.has(ext))
    throw new PathPolicyError(path, 'File type not allowed');
  const limit =
    TEXT_EXTENSIONS.has(ext) || SPECIAL_FILES.has(name) ? LIMITS.textFileBytes : LIMITS.assetBytes;
  if (size > limit) throw new PathPolicyError(path, 'File too large');
}

/**
 * Filesystem access confined to one project working tree. Every path is policy-checked and every
 * existing path component is lstat-ed: symlinks anywhere are refused (no following).
 */
export class RepoFs {
  constructor(
    readonly root: string,
    private readonly tmpDir: string,
  ) {}

  private async assertNoSymlinks(rel: string, mustExist: boolean): Promise<void> {
    let current = this.root;
    for (const segment of rel.split('/')) {
      current = join(current, segment);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new PathPolicyError(rel, 'Symbolic links are not allowed');
      } catch (error) {
        if (error instanceof PathPolicyError) throw error;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          if (mustExist) throw new PathPolicyError(rel, 'Not found');
          return;
        }
        throw error;
      }
    }
  }

  async read(path: string): Promise<Buffer> {
    const rel = normaliseRepoPath(path);
    await this.assertNoSymlinks(rel, true);
    const full = join(this.root, rel);
    const stat = await lstat(full);
    if (!stat.isFile()) throw new PathPolicyError(rel, 'Not a regular file');
    if (stat.size > LIMITS.assetBytes) throw new PathPolicyError(rel, 'File too large');
    return readFile(full);
  }

  async readText(path: string): Promise<string> {
    return (await this.read(path)).toString('utf8');
  }

  async exists(path: string): Promise<boolean> {
    const rel = normaliseRepoPath(path);
    try {
      await this.assertNoSymlinks(rel, true);
      return true;
    } catch (error) {
      if (error instanceof PathPolicyError && error.message.startsWith('Not found')) return false;
      throw error;
    }
  }

  /** Atomic write: temp file on the same filesystem, fsync, rename. */
  async write(
    path: string,
    content: Buffer | string,
    options: { managed?: boolean } = {},
  ): Promise<void> {
    const rel = normaliseRepoPath(path);
    const data = typeof content === 'string' ? Buffer.from(content) : content;
    if (!options.managed) assertWritable(rel, data.length);
    await this.assertNoSymlinks(rel, false);
    const full = join(this.root, rel);
    await mkdir(dirname(full), { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
    const tmp = join(this.tmpDir, `${randomUUID()}.tmp`);
    const handle = await open(tmp, 'wx', 0o644);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, full);
  }

  /** Removes a file and any directories left empty by it (never the root). */
  async remove(path: string): Promise<void> {
    const rel = normaliseRepoPath(path);
    await this.assertNoSymlinks(rel, true);
    await rm(join(this.root, rel));
    let dir = posix.dirname(rel);
    while (dir !== '.') {
      try {
        await rmdir(join(this.root, dir));
      } catch {
        break;
      }
      dir = posix.dirname(dir);
    }
  }

  /** Removes a directory tree after checking that nothing inside it is a symlink. */
  async removeTree(path: string): Promise<void> {
    const rel = normaliseRepoPath(path);
    if (!(await this.exists(rel))) return;
    const full = join(this.root, rel);
    const check = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new PathPolicyError(rel, 'Symbolic links are not allowed');
        if (entry.isDirectory()) await check(join(dir, entry.name));
      }
    };
    if ((await lstat(full)).isDirectory()) await check(full);
    await rm(full, { recursive: true, force: false });
  }

  /** Total size and count of files outside .git, refusing symlinks (integrity check). */
  async measure(): Promise<{ files: number; bytes: number }> {
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > LIMITS.depth) throw new PathPolicyError(dir, 'Tree too deep');
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (depth === 0 && (entry.name === '.git' || entry.name === 'node_modules')) continue;
        const full = join(dir, entry.name);
        if (entry.isSymbolicLink())
          throw new PathPolicyError(entry.name, 'Symbolic links are not allowed');
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          files++;
          bytes += (await lstat(full)).size;
        }
      }
    };
    await walk(this.root, 0);
    return { files, bytes };
  }
}
