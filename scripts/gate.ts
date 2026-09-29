/**
 * P0.2 — the per-task gate. `bun run gate`
 *
 * lint → typecheck → vitest → build → build-errors.log, stopping at the first
 * red step. The passing test count is compared against the `gate-expected-tests`
 * marker in docs/BASELINE.md: fewer passing tests than recorded is a failure;
 * the only way to accept a drop is to lower the marker in BASELINE.md with a
 * written reason, which puts the justification in the diff.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';

const BASELINE = 'docs/BASELINE.md';
const REPORT = '/tmp/gate-vitest.json';
const BUILD_LOG = '/tmp/observability/build-errors.log';

function fail(step: string, why: string): never {
  console.log(`GATE RED  step=${step}  ${why}`);
  process.exit(1);
}

function run(step: string, cmd: string, args: string[]): void {
  const t0 = performance.now();
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  if (r.status !== 0) fail(step, `exit=${r.status ?? r.signal} after ${s}s`);
  console.log(`gate: ${step} ok (${s}s)`);
}

const marker = /gate-expected-tests:\s*(\d+)/.exec(readFileSync(BASELINE, 'utf8'));
if (!marker) fail('baseline', `no "gate-expected-tests: N" marker in ${BASELINE}`);
const expected = Number(marker[1]);

run('lint', 'bunx', ['eslint', '.']);
run('typecheck', 'bunx', ['tsgo', '--noEmit']);

rmSync(REPORT, { force: true });
run('test', 'bunx', ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${REPORT}`]);
const rep = JSON.parse(readFileSync(REPORT, 'utf8')) as {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numTotalTestSuites: number;
};
if (rep.numFailedTests > 0) fail('test', `${rep.numFailedTests} failed`);
if (rep.numPassedTests < expected) {
  fail('test-count', `passed=${rep.numPassedTests} < expected=${expected}; lower the marker in ${BASELINE} with a reason`);
}

run('build', 'bunx', ['vite', 'build']);

if (existsSync(BUILD_LOG)) {
  const entries = readFileSync(BUILD_LOG, 'utf8').trim().split(/\n(?=\[?\d{4}-\d{2}-\d{2})/);
  const last = entries[entries.length - 1] ?? '';
  if (last && !/build OK/i.test(last)) fail('build-log', `latest entry is not "build OK"`);
}

const grew = rep.numPassedTests > expected ? `  (+${rep.numPassedTests - expected}; raise marker)` : '';
console.log(`GATE GREEN  lint 0 · tsgo 0 · tests ${rep.numPassedTests}/${rep.numTotalTests} (expected ≥${expected})${grew} · build OK`);
