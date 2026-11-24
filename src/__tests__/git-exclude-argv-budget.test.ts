import { describe, expect, it } from 'vitest';
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitContext, batchPathspecs } from '../git-exclude.js';

// Windows refuses to start a process whose command line passes 32,767
// characters, so a delivery naming more paths than that never reached git:
// doctor reported `spawn ENAMETOOLONG` and failed a check whose exclude rules
// git answered fine when asked one file at a time (#1977). These cases hold the
// batching that keeps one command's argv under that cap.

describe('batchPathspecs', () => {
  it('keeps every path once, in the order the caller named them', () => {
    const rels = ['a.md', 'b/c.md', 'd.md'];

    expect(batchPathspecs(rels).flat()).toEqual(rels);
  });

  it('splits a long list into batches that fit the budget', () => {
    const rels = Array.from({ length: 50 }, (_, index) => `tools/skills/skill-${index}.md`);
    const batches = batchPathspecs(rels, 200);

    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches) expect(batch.join(' ').length).toBeLessThanOrEqual(200);
    expect(batches.flat()).toEqual(rels);
  });

  it('gives a path longer than the budget a batch of its own rather than dropping it', () => {
    const long = 'x'.repeat(120);

    expect(batchPathspecs(['a', long, 'b'], 100)).toEqual([['a'], [long], ['b']]);
  });

  it('leaves no paths one empty batch, so the command still names every path', () => {
    expect(batchPathspecs([])).toEqual([[]]);
  });
});

describe('listFiles names a delivered set past the Windows command-line limit (#1977)', () => {
  it('answers for every path although the paths alone exceed 32,767 characters', async () => {
    const tmp = await fse.realpath(await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-argv-')));

    try {
      const repo = path.join(tmp, 'repo');
      await fse.ensureDir(repo);
      execFileSync('git', ['init', '-q'], { cwd: repo, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });

      // Long enough, together, to fail to spawn on Windows; the case must still
      // answer, which is what makes it a regression test there.
      const rels = Array.from({ length: 500 }, (_, index) => path.posix.join('knowledge-base', `section-${index}`, `${'note-'.repeat(8)}${index}.md`));
      for (const rel of rels) await fse.outputFile(path.join(repo, rel), `${rel}\n`);
      execFileSync('git', ['add', '--', '.'], { cwd: repo, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
      expect(rels.join(' ').length).toBeGreaterThan(32_767);

      const listed = await new GitContext().listFiles(repo, rels, 'tracked');

      expect(listed.code).toBe(0);
      expect(new Set(listed.stdout.split('\0').filter(Boolean))).toEqual(new Set(rels));
    } finally {
      await fse.remove(tmp);
    }
  });
});
