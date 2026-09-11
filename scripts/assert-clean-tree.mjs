#!/usr/bin/env node
/**
 * Publish guard — refuse to build a tarball out of an uncommitted working tree.
 *
 * `npm publish` runs `prepublishOnly`, which builds from the *working tree*, not
 * from HEAD. So a dirty tree publishes code that is not in git. That is not
 * hypothetical: `getAllele()` shipped in 0.3.0 and was missing from `main` until
 * 0.3.1, because it was uncommitted when the tarball was built.
 *
 * What this checks, and why each one can reach the tarball:
 *
 *   - Any modified/staged/deleted TRACKED file. `src/**` is compiled into
 *     `dist/` (the only entry in package.json `files`), and package.json itself
 *     is always published — so a dirty version field, tsconfig, or source file
 *     all change what consumers receive.
 *   - Untracked files under `src/`. tsconfig `include` covers everything under
 *     src/, so a new uncommitted module compiles into `dist/` exactly like a
 *     tracked one would.
 *
 * Untracked files elsewhere (scratch notes, local configs) cannot reach the
 * tarball, so they are reported as a note and do not block the publish.
 *
 * Override for a genuine emergency:  MORPHKIT_ALLOW_DIRTY_PUBLISH=1 npm publish
 */
import { execFileSync } from 'node:child_process';

const OVERRIDE = 'MORPHKIT_ALLOW_DIRTY_PUBLISH';

/** Run git, returning trimmed stdout. Throws on non-zero exit. */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** True when the working tree differs from HEAD in any tracked file. */
function hasTrackedChanges() {
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD'], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

function die(headline, details, remedy) {
  console.error(`\n✖ ${headline}\n`);
  for (const line of details) console.error(`    ${line}`);
  console.error(
    `\n  npm publish builds from the working tree, not from HEAD — publishing now\n` +
      `  would ship code that is not in git.\n\n` +
      `  ${remedy}\n` +
      `  Real emergency? ${OVERRIDE}=1 npm publish\n`,
  );
  process.exit(1);
}

if (process.env[OVERRIDE] === '1') {
  console.warn(`⚠ ${OVERRIDE}=1 — skipping the clean-tree check. The tarball may not match git.`);
  process.exit(0);
}

let insideRepo = false;
try {
  insideRepo = git(['rev-parse', '--is-inside-work-tree']) === 'true';
} catch {
  insideRepo = false;
}

if (!insideRepo) {
  die(
    'Not inside a git work tree, so the publish cannot be verified against git.',
    [],
    'Publish from a clone of the repository.',
  );
}

const problems = [];

if (hasTrackedChanges()) {
  const changed = git(['diff', 'HEAD', '--name-status']).split('\n').filter(Boolean);
  problems.push('Uncommitted changes to tracked files:', ...changed.map((l) => `  ${l}`));
}

const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'src'])
  .split('\n')
  .filter(Boolean);
if (untracked.length > 0) {
  problems.push(
    'Untracked files under src/ (these compile into dist/):',
    ...untracked.map((f) => `  ?? ${f}`),
  );
}

if (problems.length > 0) {
  die(
    'Refusing to publish: the working tree does not match git.',
    problems,
    'Commit (or stash) the changes above, then publish again.',
  );
}

// Non-blocking: cannot reach the tarball, but worth surfacing before a release.
const strays = git(['ls-files', '--others', '--exclude-standard', '--', ':!src'])
  .split('\n')
  .filter(Boolean);
if (strays.length > 0) {
  console.warn(
    `note: ${strays.length} untracked file(s) outside src/ (not published): ${strays.join(', ')}`,
  );
}

console.log(`✔ working tree is clean — publishing ${git(['rev-parse', '--short', 'HEAD'])}`);
