import {readFileSync} from 'node:fs';

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(left, right) {
  if (![left, right].every(value => typeof value === 'string' && value.length <= 64 && stableVersion.test(value))) throw new Error('Invalid stable collector or manager version');
  const a = left.split('.').map(BigInt), b = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

export function validateCollectorMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)
      || !Number.isSafeInteger(metadata.protocol) || metadata.protocol < 1 || metadata.protocol > 65535
      || !Number.isSafeInteger(metadata.minimumProtocol) || metadata.minimumProtocol < 1 || metadata.minimumProtocol > metadata.protocol) throw new Error('Invalid collector release metadata');
  for (const key of ['version', 'managerVersion', 'minimumManagerVersion']) compareVersions(metadata[key], metadata[key]);
  if (compareVersions(metadata.minimumManagerVersion, metadata.managerVersion) > 0) throw new Error('Minimum manager version exceeds the packaged manager version');
  return {version: metadata.version, protocol: metadata.protocol, minimumProtocol: metadata.minimumProtocol, managerVersion: metadata.managerVersion, minimumManagerVersion: metadata.minimumManagerVersion};
}

export function readCollectorMetadata(path = 'collector/version.json') {
  return validateCollectorMetadata(JSON.parse(readFileSync(path, 'utf8')));
}

export function renderManager(source, metadata) {
  const value = validateCollectorMetadata(metadata);
  if (source.split('__MANAGER_METADATA__').length !== 2) throw new Error('Manager metadata placeholder must occur exactly once');
  // Values are constrained to integer protocol and stable numeric SemVer strings,
  // so the JSON is safe inside the template's single-quoted Python literal.
  return source.replace('__MANAGER_METADATA__', JSON.stringify(value));
}
