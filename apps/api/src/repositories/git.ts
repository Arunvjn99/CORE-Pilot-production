import { execFile } from 'node:child_process';

/**
 * Hardened git CLI runner (decision D9, PROJECT_REPOSITORY_DESIGN.md §3).
 * - execFile with argument arrays: no shell, user text never forms options (paths follow `--`).
 * - No system/global config, no hooks, no fsmonitor, no symlinks, no transport protocols.
 */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

const HARDENING = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'core.symlinks=false',
  '-c',
  'core.fsmonitor=false',
  '-c',
  'core.autocrlf=false',
  '-c',
  'protocol.allow=never',
  '-c',
  'commit.gpgSign=false',
  '-c',
  'gc.auto=0',
  '-c',
  'init.defaultBranch=main',
];

export interface GitIdentity {
  name: string;
  email: string;
}

export class Git {
  constructor(
    private readonly binary: string,
    private readonly cwd: string,
    private readonly timeoutMs = 30_000,
  ) {}

  run(args: readonly string[], identity?: { author: GitIdentity; committer: GitIdentity }) {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      HOME: '/nonexistent',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      ...(identity
        ? {
            GIT_AUTHOR_NAME: identity.author.name,
            GIT_AUTHOR_EMAIL: identity.author.email,
            GIT_COMMITTER_NAME: identity.committer.name,
            GIT_COMMITTER_EMAIL: identity.committer.email,
          }
        : {}),
    };
    return new Promise<string>((resolve, reject) => {
      execFile(
        this.binary,
        [...HARDENING, '-c', `safe.directory=${this.cwd}`, ...args],
        {
          cwd: this.cwd,
          env,
          timeout: this.timeoutMs,
          maxBuffer: 16 * 1024 * 1024,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          if (error) {
            // stderr can contain paths but never secrets (no remotes, no credentials exist).
            reject(
              new GitError(
                `git ${args[0] ?? ''} failed: ${stderr.trim().slice(0, 500)}`,
                typeof error.code === 'number' ? error.code : null,
              ),
            );
            return;
          }
          resolve(stdout);
        },
      );
    });
  }

  init() {
    return this.run(['init', '--quiet', '-b', 'main']);
  }

  /** Stages everything (deletions included). The path policy already ran on every write. */
  addAll() {
    return this.run(['add', '--all', '--', '.']);
  }

  async hasChanges(): Promise<boolean> {
    return (await this.run(['status', '--porcelain', '--untracked-files=all'])).trim().length > 0;
  }

  async commit(message: string, author: GitIdentity, committer: GitIdentity): Promise<string> {
    await this.run(['commit', '--quiet', '--allow-empty', '--no-verify', '-m', message], {
      author,
      committer,
    });
    return this.head();
  }

  async head(): Promise<string> {
    return (await this.run(['rev-parse', '--verify', 'HEAD^{commit}'])).trim();
  }

  async commitExists(sha: string): Promise<boolean> {
    if (!/^[0-9a-f]{40}$/.test(sha)) return false;
    try {
      await this.run(['cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  /** Makes the working tree and index identical to `sha` (tracked and untracked files), without moving HEAD. */
  async restoreTree(sha: string): Promise<void> {
    await this.run(['read-tree', '--reset', '-u', sha]);
    await this.run(['clean', '-f', '-d', '-q']);
  }

  async treeHash(): Promise<string> {
    return (await this.run(['rev-parse', 'HEAD^{tree}'])).trim();
  }

  bundle(outFile: string) {
    return this.run(['bundle', 'create', '--quiet', outFile, '--all']);
  }

  fsck() {
    return this.run(['fsck', '--no-dangling', '--no-progress']);
  }
}
