import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { normaliseRepoPath, PathPolicyError, RepoFs } from '../../src/repositories/repo-fs.js';

let root: string;
let fs: RepoFs;

beforeEach(async () => {
  const base = await mkdtemp(join(tmpdir(), 'repofs-'));
  root = join(base, 'repo');
  await mkdir(root);
  fs = new RepoFs(root, join(base, 'tmp'));
});

describe('normaliseRepoPath', () => {
  it.each([
    '',
    '/etc/passwd',
    '../x',
    'src/../../x',
    'src/./x',
    'src//x',
    'src\\x',
    '.git/config',
    'src/.GIT/x',
    'node_modules/react/index.js',
    'a\u0000b',
    'a\nb',
    `${'a/'.repeat(25)}x`,
    `${'x'.repeat(300)}.ts`,
  ])('rejects %j', (path) => {
    expect(() => normaliseRepoPath(path)).toThrow(PathPolicyError);
  });

  it('accepts normal repo paths', () => {
    expect(normaliseRepoPath('src/pages/home/HomePage.tsx')).toBe('src/pages/home/HomePage.tsx');
  });
});

describe('RepoFs', () => {
  it('writes atomically and reads back', async () => {
    await fs.write('src/a.ts', 'export {};\n');
    expect(await readFile(join(root, 'src/a.ts'), 'utf8')).toBe('export {};\n');
    expect(await fs.readText('src/a.ts')).toBe('export {};\n');
  });

  it('enforces file types and sizes for non-managed writes', async () => {
    await expect(fs.write('src/run.sh', 'x')).rejects.toThrow(/File type not allowed/);
    await expect(fs.write('src/big.ts', Buffer.alloc(600 * 1024))).rejects.toThrow(/too large/);
    await fs.write('src/run.sh', 'managed only', { managed: true });
  });

  it('refuses to read, write or delete through symlinks', async () => {
    await mkdir(join(root, 'src'));
    await symlink('/etc', join(root, 'src/link'));
    await writeFile(join(root, 'outside.txt'), 'x');
    await symlink(join(root, 'outside.txt'), join(root, 'src/file.ts'));
    await expect(fs.read('src/link/passwd')).rejects.toThrow(/Symbolic links/);
    await expect(fs.write('src/link/x.ts', 'x')).rejects.toThrow(/Symbolic links/);
    await expect(fs.read('src/file.ts')).rejects.toThrow(/Symbolic links/);
    await expect(fs.remove('src/file.ts')).rejects.toThrow(/Symbolic links/);
    await expect(fs.removeTree('src')).rejects.toThrow(/Symbolic links/);
    await expect(fs.measure()).rejects.toThrow(/Symbolic links/);
  });

  it('removes files and the directories they leave empty', async () => {
    await fs.write('src/pages/x/XPage.tsx', 'x');
    await fs.write('src/keep.ts', 'x');
    await fs.remove('src/pages/x/XPage.tsx');
    expect(await fs.exists('src/pages')).toBe(false);
    expect(await fs.exists('src/keep.ts')).toBe(true);
  });
});
