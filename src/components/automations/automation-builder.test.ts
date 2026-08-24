import { describe, expect, it } from 'vitest';

import type { BuilderStep } from './automation-builder';
import { insertAt, mapAtPath, moveAt, removeAt } from './automation-builder';

type StepPath = (
  | { kind: 'root'; index: number }
  | { kind: 'branch'; parentCid: string; branch: 'yes' | 'no'; index: number }
)[];

function step(cid: string): BuilderStep {
  return {
    cid,
    step_type: 'send_message',
    step_config: { text: cid },
  };
}

function condition(cid: string, yes: BuilderStep[], no: BuilderStep[]): BuilderStep {
  return {
    cid,
    step_type: 'condition',
    step_config: {},
    branches: { yes, no },
  };
}

// Root tree used across tests:
// [cond] ── yes → [msgY1]
//       └─ no  → [msgN1, cond2(yes → [msgDeep])]
const tree: BuilderStep[] = [
  condition('c1', [step('y1')], [step('n1'), condition('c2', [step('deep')], [])]),
];

/** Path for a root-level step at `index`. */
const root = (index: number): StepPath => [{ kind: 'root', index }];
/** Path for a child inside a branch (mirrors StepRenderer's resolution). */
const branch = (
  parentPath: StepPath,
  parentCid: string,
  branchName: 'yes' | 'no',
  index: number,
): StepPath => [
  ...parentPath,
  { kind: 'branch' as const, parentCid, branch: branchName, index },
];

describe('mapAtPath — the bug fix (no duplicate branch markers)', () => {
  it('edits a direct YES-branch child', () => {
    // path: [root0, {c1,yes,0}] — the OLD code produced
    // [root0, {c1,yes,0}, {c1,yes,0}] and the edit was dropped.
    const path = branch(root(0), 'c1', 'yes', 0);
    const next = mapAtPath(tree, path, (s) => ({
      ...s,
      step_config: { text: 'edited' },
    }));
    const cond = next[0];
    expect(cond.branches?.yes[0].step_config).toEqual({ text: 'edited' });
    // Sibling branch untouched.
    expect(next[0].branches?.no[0].step_config).toEqual({ text: 'n1' });
  });

  it('edits a second child in the NO branch', () => {
    const path = branch(root(0), 'c1', 'no', 1);
    const next = mapAtPath(tree, path, (s) => ({
      ...s,
      step_config: { text: 'edited-n2' },
    }));
    expect(next[0].branches?.no[1].step_config).toEqual({ text: 'edited-n2' });
  });

  it('edits a deeply nested step (condition inside a branch)', () => {
    const path = branch(branch(root(0), 'c1', 'no', 1), 'c2', 'yes', 0);
    const next = mapAtPath(tree, path, (s) => ({
      ...s,
      step_config: { text: 'edited-deep' },
    }));
    expect(
      next[0].branches?.no[1].branches?.yes[0].step_config,
    ).toEqual({ text: 'edited-deep' });
  });

  it('leaves nodes untouched when the index is out of range', () => {
    const snapshot = JSON.stringify(tree);
    const next = mapAtPath(tree, branch(root(0), 'c1', 'yes', 99), (s) => ({
      ...s,
      step_config: { text: 'x' },
    }));
    expect(JSON.stringify(next)).toBe(snapshot);
  });
});

describe('insertAt / removeAt / moveAt on branch paths', () => {
  it('inserts into a YES branch by parentCid', () => {
    const next = insertAt(
      tree,
      { kind: 'branch', parentCid: 'c1', branch: 'yes' },
      1,
      step('new'),
    );
    expect(next[0].branches?.yes.map((s) => s.cid)).toEqual(['y1', 'new']);
  });

  it('inserts into a NESTED condition branch (regression: root-only lookup)', () => {
    // c2 lives inside c1.no — the old insertAt only scanned root-level
    // steps and silently dropped this insert.
    const next = insertAt(
      tree,
      { kind: 'branch', parentCid: 'c2', branch: 'yes' },
      1,
      step('new'),
    );
    expect(
      next[0].branches?.no[1].branches?.yes.map((s) => s.cid),
    ).toEqual(['deep', 'new']);
  });

  it('removes via a resolved branch path', () => {
    const path = branch(root(0), 'c1', 'yes', 0);
    const next = removeAt(tree as BuilderStep[], path as never);
    expect(next[0].branches?.yes).toEqual([]);
    expect(next[0].branches?.no.length).toBe(2);
  });

  it('moves within a branch via a resolved branch path', () => {
    const path = branch(root(0), 'c1', 'no', 1);
    const next = moveAt(tree, path as never, -1);
    expect(next[0].branches?.no.map((s) => s.cid)).toEqual(['c2', 'n1']);
  });

  it('removes a nested condition via a deep branch path', () => {
    const path = branch(branch(root(0), 'c1', 'no', 1), 'c2', 'yes', 0);
    const next = removeAt(tree as BuilderStep[], path as never);
    expect(next[0].branches?.no[1].branches?.yes).toEqual([]);
  });
});
