#!/usr/bin/env node
// Safe rebuild script: only attempt to rebuild the native addon when running
// under the Node ABI we want (avoids noisy rebuild attempts under other Node versions).
const { execSync } = require('child_process');

// Target ABI(s) you'd like to build for. For Node v20.x this is 115.
const TARGET_ABIS = [115];

const abi = process.versions && process.versions.modules ? Number(process.versions.modules) : null;
console.log(`rebuild-native: current Node version=${process.version} ABI=${abi}`);

if (abi && TARGET_ABIS.includes(abi)) {
  console.log(`rebuild-native: ABI ${abi} matches target; attempting rebuild`);
  try {
    execSync('npm rebuild @maplibre/maplibre-gl-native --build-from-source', { stdio: 'inherit' });
    console.log('rebuild-native: rebuild finished');
  } catch (err) {
    console.warn('rebuild-native: rebuild failed, continuing without native addon:', err && err.message);
    process.exitCode = 0; // ensure postinstall doesn't fail
  }
} else {
  console.log(`rebuild-native: ABI ${abi} does not match target (${TARGET_ABIS.join(',')}); skipping rebuild`);
}
