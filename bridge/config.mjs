import { isAbsolute } from 'node:path';
import { readFile } from 'node:fs/promises';

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
function only(value, keys) {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unknown configuration field');
}
export function validateConfig(config) {
  record(config, 'Configuration');
  only(config, ['id', 'label', 'native', 'offline_setup']);
  if (typeof config.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(config.id)) throw new Error('Device id must be 1-40 lowercase letters/digits/hyphens, starting with a letter');
  if (typeof config.label !== 'string' || !config.label.trim() || config.label.length > 80 || /[\x00-\x1f\x7f]/.test(config.label)) throw new Error('Invalid device label');
  if (config.offline_setup !== undefined && typeof config.offline_setup !== 'boolean') throw new Error('offline_setup must be boolean');
  if (config.native !== undefined) {
    record(config.native, 'native');
    only(config.native, ['executable', 'codex_home']);
    for (const value of Object.values(config.native)) {
      if (typeof value !== 'string' || !isAbsolute(value) || /[\0\r\n]/.test(value)) throw new Error('Native paths must be absolute paths on this device');
    }
  }
  return config;
}
export async function readConfig(path) {
  return validateConfig(JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')));
}
