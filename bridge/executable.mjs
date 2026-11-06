import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativeEnvironment } from './environment.mjs';

const runFile = promisify(execFile);
const INVALID = /[\x00-\x1f\x7f]/;
const SCRIPT = /\.(?:cmd|bat|ps1)$/i;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const APPX_QUERY = '$ErrorActionPreference = "Stop"; [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-AppxPackage | Select-Object PackageFamilyName, InstallLocation, Status) | ConvertTo-Json -Compress';

export function absoluteExecutablePath(value, platform = process.platform) {
  if (typeof value !== 'string' || !value || INVALID.test(value)) return false;
  return platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(value) && !value.slice(2).includes(':') : path.posix.isAbsolute(value);
}
export function validateExecutableSource(source, platform = process.platform) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('executable_source must be an object');
  const keys = source.kind === 'path' ? ['kind', 'path'] : ['kind', 'package_family', 'relative_path'];
  if (Object.keys(source).some(key => !keys.includes(key))) throw new Error('Unknown executable_source field');
  if (source.kind === 'path') {
    if (!absoluteExecutablePath(source.path, platform) || SCRIPT.test(source.path)) throw new Error('Executable source must name an absolute native executable path');
  } else if (source.kind === 'windows-appx') {
    if (platform !== 'win32') throw new Error('windows-appx discovery is only supported on Windows');
    if (typeof source.package_family !== 'string' || !/^[A-Za-z0-9.-]+_[A-Za-z0-9]+$/.test(source.package_family)) throw new Error('Invalid registered package family');
    const relative = source.relative_path;
    if (typeof relative !== 'string' || INVALID.test(relative) || /[:<>"|?*]/.test(relative) || path.win32.isAbsolute(relative) || relative.split(/[\\/]/).some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || WINDOWS_DEVICE_NAME.test(part)) || !/\.exe$/i.test(relative)) throw new Error('Package executable must be a confined relative .exe path');
  } else throw new Error('Unknown executable source kind');
  return source;
}

// Query only packages registered to the current OS user. No -AllUsers, elevation,
// WindowsApps directory scan, PATH-selected PowerShell, or interpolated script.
export async function registeredPackages(environment = process.env, options = {}) {
  const root = environment.SystemRoot || environment.SYSTEMROOT;
  if (!absoluteExecutablePath(root, 'win32')) throw new Error('Cannot locate system PowerShell for current-user package discovery');
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  let output;
  try {
    output = await (options.runFile || runFile)(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', APPX_QUERY], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true, shell: false,
      env: nativeEnvironment({ codex_home: environment.CODEX_HOME }, environment),
    });
  } catch { throw new Error('Current-user package discovery failed or was denied; no alternate executable was selected'); }
  let records;
  try { records = JSON.parse(output.stdout.replace(/^\uFEFF/, '') || '[]'); }
  catch { throw new Error('Current-user package discovery returned invalid metadata'); }
  records = Array.isArray(records) ? records : [records];
  if (records.some(record => !record || typeof record !== 'object' || typeof record.PackageFamilyName !== 'string' || typeof record.InstallLocation !== 'string')) throw new Error('Current-user package discovery returned invalid metadata');
  return records;
}

function inside(root, candidate, pathApi) {
  const relative = pathApi.relative(root, candidate);
  return relative && relative !== '..' && !relative.startsWith('..' + pathApi.sep) && !pathApi.isAbsolute(relative) ? relative : null;
}
function healthyPackage(record) {
  // PowerShell serializes the Ok enum as 0; fixture/explicit text is accepted too.
  return record.Status === 0 || record.Status === 'Ok';
}
export function selectPackage(source, records) {
  validateExecutableSource(source, 'win32');
  const matches = records.filter(record => record.PackageFamilyName.toLowerCase() === source.package_family.toLowerCase());
  if (matches.length !== 1) throw new Error('Configured package is missing or ambiguous for this OS user; no fallback was attempted');
  const record = matches[0];
  if (!healthyPackage(record) || !absoluteExecutablePath(record.InstallLocation, 'win32')) throw new Error('Configured package is unavailable or has an invalid install location');
  return { path: path.win32.join(record.InstallLocation, source.relative_path), root: record.InstallLocation };
}

async function inspectExecutable(candidate, environment, options = {}) {
  const platform = options.platform || process.platform;
  if (!absoluteExecutablePath(candidate, platform) || SCRIPT.test(candidate)) throw new Error('Codex must be an absolute native executable, not a command shim');
  const resolved = await (options.realpath || realpath)(candidate);
  if (!absoluteExecutablePath(resolved, platform) || SCRIPT.test(resolved)) throw new Error('Codex resolved to an unsupported executable path');
  if (platform === 'win32' && !/\.exe$/i.test(resolved)) throw new Error('Windows Codex must be a native .exe');
  if (options.root) {
    const root = await (options.realpath || realpath)(options.root);
    if (!inside(root, resolved, path.win32)) throw new Error('Package executable resolves outside the registered installation');
  }
  if (!(await (options.stat || stat)(resolved)).isFile()) throw new Error('Codex executable is not a regular file');
  await (options.access || access)(resolved, constants.X_OK);
  let result;
  try {
    result = await (options.runFile || runFile)(resolved, ['--version'], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 65536, windowsHide: true, shell: false,
      env: nativeEnvironment({ codex_home: environment.CODEX_HOME }, environment),
    });
  } catch (error) {
    // Do not forward child stdout/stderr or execFile's error.message (may contain it).
    throw new Error(`Codex version probe failed (${error.code === 'ENOENT' ? 'executable disappeared' : error.code === 'EACCES' || error.code === 'EPERM' ? 'access denied' : 'nonzero exit or timeout'}); no fallback was attempted`);
  }
  const version = result.stdout.trim();
  if (!/^codex-cli\s[^\r\n]+$/.test(version) || INVALID.test(version)) throw new Error('Selected executable did not report a Codex CLI version');
  return { path: resolved, launchPath: candidate, version };
}

export async function findCodex(explicit, environment = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const candidate = explicit !== undefined ? explicit : environment.CODEX_EXE;
  if (candidate !== undefined) {
    if (!absoluteExecutablePath(candidate, platform)) throw new Error('Explicit Codex executable must be an absolute path');
    return inspectExecutable(candidate, environment, options); // Explicit means no fallback.
  }
  const directories = [...new Set((environment.PATH || '').split(pathApi.delimiter))].filter(dir => absoluteExecutablePath(dir, platform));
  for (const directory of directories) {
    const executable = pathApi.join(directory, platform === 'win32' ? 'codex.exe' : 'codex');
    try { await (options.lstat || lstat)(executable); }
    catch (error) {
      // Only a missing directory entry is a PATH miss. Once an entry is chosen,
      // even a dangling symlink or an upgrade race must not select another install.
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      continue;
    }
    return inspectExecutable(executable, environment, options);
  }
  throw new Error('Official Codex executable not found on absolute PATH entries. Install Codex separately or pass --codex ABSOLUTE_NATIVE_EXECUTABLE (Windows: codex.exe, not a .cmd shim).');
}

export async function executableSource(codex, environment = process.env, options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'win32') {
    const records = await (options.registeredPackages || registeredPackages)(environment);
    const matches = records.filter(record => absoluteExecutablePath(record.InstallLocation, platform) &&
      (inside(record.InstallLocation, codex.launchPath, path.win32) || inside(record.InstallLocation, codex.path, path.win32)));
    if (matches.length > 1) throw new Error('Executable belongs to ambiguous registered packages');
    if (matches.length === 1) {
      const record = matches[0];
      // Keep a selected in-package entry even if the registered root is a junction
      // or that entry is a symlink. The canonical executable must still stay inside.
      const relative = inside(record.InstallLocation, codex.launchPath, path.win32) || inside(record.InstallLocation, codex.path, path.win32);
      const source = { kind: 'windows-appx', package_family: record.PackageFamilyName, relative_path: relative };
      selectPackage(source, records);
      const canonicalRoot = await (options.realpath || realpath)(record.InstallLocation);
      if (!inside(canonicalRoot, codex.path, path.win32)) throw new Error('Package executable resolves outside the registered installation');
      return source;
    }
  }
  // Preserve the selected symlink/app bundle path, not its versioned realpath.
  return validateExecutableSource({ kind: 'path', path: codex.launchPath }, platform);
}

export async function resolveNativeExecutable(config = {}, environment = process.env, options = {}) {
  if (config.executable !== undefined && config.executable_source !== undefined) throw new Error('Choose executable or executable_source, not both');
  const explicit = config.executable !== undefined ? config.executable : environment.CODEX_EXE;
  environment = nativeEnvironment(config, environment);
  if (config.executable_source === undefined) return findCodex(explicit, environment, options);
  const platform = options.platform || process.platform;
  if (!absoluteExecutablePath(config.codex_home, platform)) throw new Error('Executable discovery requires a fixed absolute codex_home');
  const source = validateExecutableSource(config.executable_source, platform);
  if (source.kind === 'path') return inspectExecutable(source.path, environment, options);
  const selected = selectPackage(source, await (options.registeredPackages || registeredPackages)(environment));
  return inspectExecutable(selected.path, environment, { ...options, root: selected.root });
}
