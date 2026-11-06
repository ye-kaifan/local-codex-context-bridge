import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { findCodex, executableSource, resolveNativeExecutable, registeredPackages, selectPackage, validateExecutableSource } from '../bridge/executable.mjs';
import { validateConfig } from '../bridge/config.mjs';
import { setupNativeConfig } from '../scripts/setup.mjs';
import { selectSchemaCodex } from '../scripts/check-native-schema.mjs';

function missing() { return Object.assign(new Error('fixture missing'), { code: 'ENOENT' }); }
function fixture(platform = 'darwin') {
  const probes = [];
  const options = { platform, realpath: async p => p, lstat: async () => ({}),
    stat: async () => ({ isFile: () => true }), access: async () => {},
    runFile: async (p, args, policy) => { probes.push({ p, args, policy }); return { stdout: 'codex-cli 0.164.0\n' }; } };
  return { probes, options };
}
const family = 'OpenAI.Codex_2p2nqsd0c76g0';
const packageSource = { kind: 'windows-appx', package_family: family, relative_path: 'app\\resources\\codex.exe' };
const registration = root => ({ PackageFamilyName: family, InstallLocation: root, Status: 0 });

test('PATH discovery ignores empty and relative entries, preserves the chosen lexical path and strips secrets', async () => {
  const { probes, options } = fixture();
  const result = await findCodex(undefined, { PATH: ':relative:/selected:/unused', CODEX_HOME: '/fixed-home', CONTROL_PLANE_API_KEY: 'fixture-secret', OPENAI_API_KEY: 'fixture-secret', NODE_OPTIONS: '--untrusted' }, {
    ...options, realpath: async p => p === '/selected/codex' ? '/vendor/v1/codex' : p,
  });
  assert.equal(result.launchPath, '/selected/codex');
  assert.equal(result.path, '/vendor/v1/codex');
  assert.equal(probes.length, 1);
  assert.deepEqual(probes[0].args, ['--version']);
  assert.equal(probes[0].policy.shell, false);
  assert.equal(probes[0].policy.timeout, 10000);
  assert.equal(probes[0].policy.env.CODEX_HOME, '/fixed-home');
  for (const key of ['CONTROL_PLANE_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(probes[0].policy.env[key], undefined);
});

test('explicit and legacy executable pins never fall back to PATH', async () => {
  const { options, probes } = fixture();
  const check = { ...options, realpath: async () => { throw missing(); } };
  await assert.rejects(findCodex('/missing/codex', { PATH: '/other' }, check), { code: 'ENOENT' });
  await assert.rejects(resolveNativeExecutable({ executable: '/missing/codex' }, { PATH: '/other' }, check), { code: 'ENOENT' });
  await assert.rejects(findCodex(undefined, { CODEX_EXE: '/missing/codex', PATH: '/other' }, check), { code: 'ENOENT' });
  for (const value of [null, '', 'relative', '/path\n/codex', '/path/codex.cmd']) await assert.rejects(findCodex(value, { PATH: '/other' }, options));
  assert.equal(probes.length, 0);
});

test('only an absent PATH entry is skipped; denied, dangling, directory, invalid and timed-out executables fail closed', async () => {
  const { options } = fixture();
  const seen = [];
  const base = { ...options, lstat: async p => { seen.push(p); if (p.startsWith('/absent/')) throw missing(); } };
  assert.equal((await findCodex(undefined, { PATH: '/absent:/good' }, base)).path, '/good/codex');
  assert.deepEqual(seen, ['/absent/codex', '/good/codex']);
  for (const change of [
    { lstat: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } },
    { realpath: async () => { throw missing(); } },
    { stat: async () => ({ isFile: () => false }) },
    { access: async () => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); } },
    { runFile: async () => ({ stdout: 'other-cli 1.0' }) },
    { runFile: async () => { throw Object.assign(new Error('PRIVATE_CHILD_OUTPUT'), { code: 'ETIMEDOUT', stdout: 'PRIVATE_CHILD_OUTPUT' }); } },
  ]) {
    const paths = [];
    await assert.rejects(findCodex(undefined, { PATH: '/chosen:/alternate' }, { ...options,
      lstat: async p => { paths.push(p); }, ...change }), error => !error.message.includes('PRIVATE_CHILD_OUTPUT'));
    assert.ok(!paths.some(p => p.startsWith('/alternate/')));
  }
});

test('stable path source follows a symlink upgrade and ignores changed PATH', { skip: process.platform === 'win32' }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-source-upgrade-'));
  try {
    const stable = join(dir, 'codex'), old = join(dir, 'version-1'), next = join(dir, 'version-2');
    for (const [file, version] of [[old, '1.0'], [next, '2.0']]) {
      await writeFile(file, `#!/bin/sh\nprintf 'codex-cli ${version}\\n'\n`); await chmod(file, 0o700);
    }
    await symlink(old, stable);
    const source = { kind: 'path', path: stable };
    const config = { executable_source: source, codex_home: dir };
    assert.equal((await resolveNativeExecutable(config, { PATH: '/irrelevant' })).version, 'codex-cli 1.0');
    await unlink(stable); await unlink(old); await symlink(next, stable);
    assert.equal((await resolveNativeExecutable(config, { PATH: '/different' })).version, 'codex-cli 2.0');
    await unlink(stable);
    await assert.rejects(resolveNativeExecutable(config, { PATH: '/different' }), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('Windows package source follows current-user registration across versioned directories', async () => {
  const { options, probes } = fixture('win32');
  let root = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_1_x64__publisher';
  const deps = { ...options, registeredPackages: async () => [registration(root)] };
  const original = await findCodex(root + '\\app\\resources\\codex.exe', {}, deps);
  const source = await executableSource(original, {}, deps);
  assert.deepEqual(source, packageSource);
  const config = { executable_source: source, codex_home: 'C:\\CodexHome' };
  assert.equal((await resolveNativeExecutable(config, {}, deps)).path, original.path);
  root = 'C:\\Program Files\\WindowsApps\\OpenAI.Codex_2_x64__publisher';
  const result = await resolveNativeExecutable(config, { CODEX_EXE: 'C:\\wrong\\codex.exe' }, deps);
  assert.equal(result.path, root + '\\app\\resources\\codex.exe');
  assert.equal(probes.at(-1).policy.env.CODEX_HOME, 'C:\\CodexHome');
});

test('Windows source validation rejects traversal, aliases, scripts, device paths and alternate streams', () => {
  for (const relative_path of ['..\\codex.exe', 'app\\..\\codex.exe', 'C:codex.exe', 'C:\\codex.exe', '\\\\server\\codex.exe', '\\codex.exe', 'app:evil\\codex.exe', 'app\\codex.cmd', 'app\\\\codex.exe', 'app\\.\\codex.exe', 'app\\co\ndex.exe', '.. \\codex.exe', 'app.\\codex.exe', 'nul\\codex.exe', 'app\\COM1.exe', 'app\\*.exe']) {
    assert.throws(() => validateExecutableSource({ ...packageSource, relative_path }, 'win32'));
  }
  for (const path of ['C:codex.exe', '\\codex.exe', '\\\\?\\C:\\codex.exe', '\\\\server\\codex.exe', 'C:\\x:stream.exe']) assert.throws(() => validateExecutableSource({ kind: 'path', path }, 'win32'));
  assert.throws(() => validateExecutableSource(packageSource, 'darwin'), /Windows/);
});

test('package mismatch, ambiguity, unavailable status and canonical path escape fail closed', async () => {
  const root = 'C:\\Apps\\Package';
  for (const rows of [[], [{ ...registration(root), PackageFamilyName: 'Other.Package_abc' }], [registration(root), registration('C:\\Other')], [{ ...registration(root), Status: 1 }], [registration('relative')]]) assert.throws(() => selectPackage(packageSource, rows));
  const { options, probes } = fixture('win32');
  await assert.rejects(resolveNativeExecutable({ executable_source: packageSource, codex_home: 'C:\\Home' }, {}, {
    ...options, registeredPackages: async () => [registration(root)],
    realpath: async p => p === root ? root : 'C:\\Outside\\codex.exe',
  }), /outside/);
  assert.equal(probes.length, 0);
});

test('package discovery uses current-user system PowerShell with bounded output and no interpolated input', async () => {
  let call;
  const rows = await registeredPackages({ SystemRoot: 'C:\\Windows', PATH: 'C:\\Untrusted', CONTROL_PLANE_API_KEY: 'fixture' }, {
    runFile: async (exe, args, options) => { call = { exe, args, options }; return { stdout: JSON.stringify([registration('C:\\Apps\\Package')]) }; },
  });
  assert.equal(rows.length, 1);
  assert.equal(call.exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(call.options.shell, false); assert.equal(call.options.env.CONTROL_PLANE_API_KEY, undefined);
  assert.ok(call.options.timeout <= 10000); assert.ok(call.options.maxBuffer <= 1024 * 1024);
  assert.ok(call.args.includes('-NoProfile')); assert.doesNotMatch(call.args.at(-1), /AllUsers|Untrusted/);
  for (const stdout of ['{broken', 'null', '[1]', '[{}]']) await assert.rejects(registeredPackages({ SystemRoot: 'C:\\Windows' }, { runFile: async () => ({ stdout }) }), /invalid metadata/);
  await assert.rejects(registeredPackages({ SystemRoot: 'C:\\Windows' }, { runFile: async () => { throw new Error('PRIVATE_OUTPUT'); } }), error => /failed or was denied/.test(error.message) && !error.message.includes('PRIVATE_OUTPUT'));
});

test('setup preserves explicit pins, records PATH anchors, and requires explicit follow-updates for package sources', async () => {
  const path = resolve('vendor', 'codex'), launchPath = resolve('stable', 'codex'), home = resolve('home');
  let sourceCalls = 0;
  const deps = { findCodex: async () => ({ path, launchPath, version: 'codex-cli 1.0' }), executableSource: async () => { sourceCalls++; return { kind: 'path', path: launchPath }; } };
  assert.deepEqual((await setupNativeConfig({}, home, {}, deps)).native, { codex_home: home, executable_source: { kind: 'path', path: launchPath } });
  for (const [options, env] of [[{ codex: path }, {}], [{}, { CODEX_EXE: path }]]) {
    assert.deepEqual((await setupNativeConfig(options, home, env, deps)).native, { codex_home: home, executable: path });
  }
  assert.equal(sourceCalls, 0);
  assert.deepEqual((await setupNativeConfig({ codex: path, 'follow-updates': true }, home, {}, deps)).native.executable_source, { kind: 'path', path: launchPath });
  assert.equal(sourceCalls, 1);
});

test('config requires a fixed home for discovery and rejects mixed selectors without migrating legacy pins', () => {
  const native = { executable_source: { kind: 'path', path: resolve('codex') }, codex_home: resolve('home') };
  assert.equal(validateConfig({ id: 'test', label: 'Test', native }).native, native);
  assert.throws(() => validateConfig({ id: 'test', label: 'Test', native: { executable_source: native.executable_source } }), /fixed codex_home/);
  assert.throws(() => validateConfig({ id: 'test', label: 'Test', native: { ...native, executable: resolve('codex') } }), /not both/);
  assert.equal(validateConfig({ id: 'test', label: 'Test', native: { executable: resolve('codex') } }).native.executable, resolve('codex'));
});

test('schema qualification uses exactly the configured source and home', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-schema-source-'));
  try {
    const config = join(dir, 'device.json'), home = join(dir, 'home');
    await mkdir(home);
    const native = { executable_source: { kind: 'path', path: join(dir, 'codex') }, codex_home: home };
    await writeFile(config, JSON.stringify({ id: 'test', label: 'Test', native }));
    let calls = 0;
    const selected = await selectSchemaCodex({ config }, () => { throw new Error('must not use another selector'); }, async (actual, env) => {
      calls++; assert.deepEqual(actual, native); assert.equal(env.CODEX_HOME, home); return { path: native.executable_source.path, version: 'codex-cli 1.0' };
    });
    assert.equal(calls, 1); assert.equal(selected.environment.CODEX_HOME, home);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('registered package root junctions preserve the selected relative entry and reject escaping targets', async () => {
  const { options } = fixture('win32');
  const root = 'C:\\Packages\\Codex-v1', canonical = 'D:\\Apps\\Codex-v1';
  const codex = { launchPath: root + '\\app\\codex.exe', path: canonical + '\\vendor\\codex.exe' };
  const deps = { ...options, registeredPackages: async () => [registration(root)], realpath: async p => p === root ? canonical : p };
  assert.deepEqual(await executableSource(codex, {}, deps), { kind: 'windows-appx', package_family: family, relative_path: 'app\\codex.exe' });
  await assert.rejects(executableSource({ ...codex, path: 'D:\\Outside\\codex.exe' }, {}, deps), /outside/);
});

test('invalid source selectors cannot fall back or inherit an ambient home', async () => {
  const { options, probes } = fixture();
  for (const config of [{ executable: null }, { executable_source: null }, { executable: '/pin', executable_source: null }, { executable_source: { kind: 'path', path: '/codex' } }]) {
    await assert.rejects(resolveNativeExecutable(config, { CODEX_EXE: '/alternate', CODEX_HOME: '/ambient', PATH: '/alternate' }, options));
  }
  assert.equal(probes.length, 0);
  await resolveNativeExecutable({ executable_source: { kind: 'path', path: '/codex' }, codex_home: '/fixed' }, { CODEX_HOME: '/ambient' }, options);
  assert.equal(probes[0].policy.env.CODEX_HOME, '/fixed');
});
