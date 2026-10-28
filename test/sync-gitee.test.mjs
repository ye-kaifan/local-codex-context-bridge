import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Execute the actual workflow shell, with Git's URLs rewritten to disposable bare
// repositories and all protocols except file disabled. No credential or network use.
const workflow = await readFile('.github/workflows/sync-gitee.yml', 'utf8');
const block = workflow.split('        run: |\n');
assert.equal(block.length, 2);
const script = block[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');

test('Gitee workflow scopes trigger/secrets to the intended repository and refs', () => {
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /tags: \['v\*'\]/);
  assert.match(workflow, /github\.repository == 'ye-kaifan\/local-codex-context-bridge'/);
  assert.match(workflow, /permissions: \{\}/);
  assert.doesNotMatch(script, /--force|--mirror|--delete/);
  assert.doesNotMatch(script, /export GIT_ASKPASS/);
});

test('actual Gitee sync shell copies only main/v*, preserves other refs and rejects divergence', { skip: process.platform === 'win32' ? 'POSIX Actions shell; exercised on macOS CI' : false, timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'context-sync-test-'));
  const source = join(dir, 'source'), target = join(dir, 'target.git'), clone = join(dir, 'target-work');
  const config = join(dir, 'gitconfig'), runner = join(dir, 'runner');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file',
    GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    RUNNER_TEMP: runner, GITEE_SYNC_TOKEN: 'synthetic-not-a-credential', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_ASKPASS; delete env.SSH_ASKPASS;
  const git = (...args) => {
    const result = spawnSync('git', args, { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  const run = () => spawnSync('bash', ['-e'], { input: script, env, encoding: 'utf8', timeout: 15000 });
  try {
    await writeFile(config, ''); await mkdir(runner);
    git('init', '--quiet', '--initial-branch=main', source);
    git('init', '--quiet', '--bare', '--initial-branch=main', target);
    await writeFile(join(source, 'fixture.txt'), 'base');
    git('-C', source, 'add', '.'); git('-C', source, 'commit', '--quiet', '-m', 'base');
    const base = git('-C', source, 'rev-parse', 'HEAD');
    git('-C', source, 'tag', 'private-note');
    git('-C', source, 'tag', 'v/not-a-version');
    git('-C', source, 'branch', 'do-not-mirror');
    git('config', '--file', config, `url.${pathToFileURL(source).href}.insteadOf`, 'https://github.com/ye-kaifan/local-codex-context-bridge.git');
    git('config', '--file', config, `url.${pathToFileURL(target).href}.insteadOf`, 'https://gitee.com/ye-kaifan/local-codex-context-bridge.git');
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('--git-dir', target, 'for-each-ref', '--format=%(refname)'), 'refs/heads/main');
    git('-C', source, 'tag', 'v1.0.0');
    result = run();
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(git('--git-dir', target, 'for-each-ref', '--format=%(refname)').split('\n'), ['refs/heads/main', 'refs/tags/v1.0.0']);
    assert.equal(git('--git-dir', target, 'rev-parse', 'main'), base);
    git('--git-dir', target, 'update-ref', 'refs/heads/keep-on-gitee', base);
    git('clone', '--quiet', target, clone);
    await writeFile(join(clone, 'destination-only.txt'), 'destination history');
    git('-C', clone, 'add', '.'); git('-C', clone, 'commit', '--quiet', '-m', 'destination-only');
    git('-C', clone, 'push', '--quiet', 'origin', 'main');
    const destinationHead = git('--git-dir', target, 'rev-parse', 'main');
    await writeFile(join(source, 'fixture.txt'), 'source change');
    git('-C', source, 'commit', '--quiet', '-am', 'source change');
    result = run();
    assert.notEqual(result.status, 0);
    assert.equal(git('--git-dir', target, 'rev-parse', 'main'), destinationHead);
    assert.equal(git('--git-dir', target, 'rev-parse', 'refs/heads/keep-on-gitee'), base);
    assert.equal(git('--git-dir', target, 'rev-parse', 'refs/tags/v1.0.0'), base);
    assert.ok(!(result.stdout + result.stderr).includes(env.GITEE_SYNC_TOKEN));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
