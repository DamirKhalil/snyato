import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readExecutionProfile } from './execution-profile.mjs';

// Keep the established managed installer and use the same frozen pnpm inputs
// on portable hosts, without replacing the user's HOME or registry settings.
const managed = readExecutionProfile() === 'managed-linux';
const result = managed
  ? spawnSync('bash', [fileURLToPath(new URL('./install-pnpm.sh', import.meta.url))], { stdio: 'inherit' })
  : spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['install', '--frozen-lockfile', '--prefer-offline'], { stdio: 'inherit', shell: process.platform === 'win32' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
process.exit(result.status ?? 1);
