import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSkillPaths, writeIsolationFragment } from '../scripts/isolation.mjs';

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'context-isolation-'));
  try {
    const dirs = ['2.1.0', '2.1.1'].map(version => join(root, 'plugin cache', version, 'read context'));
    for (const dir of dirs) {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'SKILL.md'), '# Synthetic skill\n');
    }
    await run(root, dirs);
  } finally { await rm(root, { recursive: true }); }
}

test('isolation resolves installed directories and explicit files, deduplicating aliases across versions', async () => {
  await fixture(async (_root, [old, current]) => {
    const files = [old, current].map(dir => join(dir, 'SKILL.md'));
    assert.deepEqual(await resolveSkillPaths([old, files[0], old + '/', join(old, '.', 'SKILL.md'), current, files[1]]), files);
  });
});

test('isolation CLI accepts repeated skills with spaces and writes only a no-clobber fragment', async () => {
  await fixture(async (root, dirs) => {
    const config = join(root, 'existing-config.toml');
    const before = '[unrelated]\nenabled = true\n';
    await writeFile(config, before);
    const out = join(root, 'fragment.toml');
    const args = [resolve('scripts/isolation.mjs'), '--plugin', 'example-plugin', '--plugin', 'example-plugin', '--app', 'example-device', '--app', 'example-device',
      ...dirs.flatMap(dir => ['--skill', dir, '--skill', join(dir, 'SKILL.md')]), '--out', out];
    const child = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const text = await readFile(out, 'utf8');
    assert.equal((text.match(/\[plugins\./g) ?? []).length, 1);
    assert.equal((text.match(/\[apps\./g) ?? []).length, 1);
    assert.equal((text.match(/\[\[skills.config\]\]/g) ?? []).length, 2);
    for (const dir of dirs) assert.ok(text.includes(`path = ${JSON.stringify(join(dir, 'SKILL.md'))}\nenabled = false`));
    assert.match(child.stdout, /No Codex settings were changed/);
    const repeat = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.notEqual(repeat.status, 0);
    assert.match(repeat.stderr, /EEXIST/);
    assert.equal(await readFile(out, 'utf8'), text);
    assert.equal(await readFile(config, 'utf8'), before);
    assert.deepEqual((await readdir(root)).sort(), ['existing-config.toml', 'fragment.toml', 'plugin cache']);
  });
});

test('isolation rejects missing paths, wrong files and a SKILL.md directory before creating output', async () => {
  await fixture(async (root, [valid]) => {
    const wrong = join(root, 'README.md');
    await writeFile(wrong, '# Wrong file\n');
    const empty = join(root, 'empty');
    await mkdir(join(empty, 'SKILL.md'), { recursive: true });
    const missingSkill = join(root, 'no skill');
    await mkdir(missingSkill);
    const out = join(root, 'invalid-fragment.toml');
    for (const skill of [join(root, 'missing'), join(root, 'missing', 'SKILL.md'), wrong, empty, join(empty, 'SKILL.md'), missingSkill]) {
      await assert.rejects(writeIsolationFragment({ skill: [valid, skill], out }));
      await assert.rejects(readFile(out), /ENOENT/);
    }
  });
});

test('isolation rejects blank, relative and control-character skill paths without filesystem access', async () => {
  for (const platform of ['darwin', 'win32']) {
    const inputs = ['', ' ', '.', 'skills/read-context', 'SKILL.md', '~/skill', 'C:skill', '/bad\npath', '/bad\0path', '/bad\x7fpath'];
    if (platform === 'win32') inputs.push('/root-relative', '\\root-relative');
    else inputs.push('C:\\skills\\read-context', '\\\\server\\share\\skill');
    for (const input of inputs) {
      await assert.rejects(resolveSkillPaths([input], { platform, statPath: async () => assert.fail('Invalid path reached filesystem') }), /absolute skill/);
    }
  }
});

test('isolation models Windows drive, UNC, separator and case semantics with synthetic filesystem entries', async () => {
  const dirs = ['C:\\Plugin Cache\\2.1.0\\skill', 'C:\\Plugin Cache\\2.1.1\\skill', '\\\\server\\share\\Plugin Cache\\skill'];
  const files = dirs.map(dir => dir + '\\SKILL.md');
  const calls = [];
  const statPath = async path => {
    calls.push(path);
    const isFile = files.some(file => file.toLowerCase() === path.toLowerCase());
    const isDirectory = dirs.some(dir => dir.toLowerCase() === path.toLowerCase());
    assert.ok(isFile || isDirectory, 'Unexpected synthetic path');
    return { isFile: () => isFile, isDirectory: () => isDirectory };
  };
  assert.deepEqual(await resolveSkillPaths([dirs[0], 'c:/plugin cache/2.1.0/skill/SKILL.md', ...dirs.slice(1), ...files], { platform: 'win32', statPath }), files);
  assert.ok(calls.includes(files[2]));
});

test('isolation models macOS POSIX paths with distinct case and installed versions using synthetic entries', async () => {
  const dirs = ['/Users/example/Plugin Cache/2.1.0/skill', '/Users/example/Plugin Cache/2.1.1/skill', '/Users/example/Plugin Cache/2.1.1/Skill'];
  const files = dirs.map(dir => dir + '/SKILL.md');
  const statPath = async path => {
    assert.ok(dirs.includes(path) || files.includes(path), 'Unexpected synthetic path');
    return { isFile: () => files.includes(path), isDirectory: () => dirs.includes(path) };
  };
  assert.deepEqual(await resolveSkillPaths([dirs[0], files[0], ...dirs.slice(1)], { platform: 'darwin', statPath }), files);
});

test('isolation requires targets and output, validates identities, and leaves failed output absent', async () => {
  await fixture(async (root, [valid]) => {
    const out = join(root, 'never-written.toml');
    for (const values of [{}, { out }, { skill: [valid] }, { plugin: [''], out }, { app: ['bad\nidentity'], out }, { app: ['x'.repeat(201)], out }]) {
      await assert.rejects(writeIsolationFragment(values));
      await assert.rejects(readFile(out), /ENOENT/);
    }
    const child = spawnSync(process.execPath, [resolve('scripts/isolation.mjs'), '--skill', '--out', out], { encoding: 'utf8' });
    assert.notEqual(child.status, 0);
    await assert.rejects(readFile(out), /ENOENT/);
  });
});
