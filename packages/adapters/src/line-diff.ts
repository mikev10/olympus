/**
 * Which lines of `after` are new: the lines a shortest edit script from
 * `before` inserts (Myers, "An O(ND) Difference Algorithm and Its
 * Variations", 1986). Computed in process, so no diff tool is spawned over a
 * tree an agent wrote.
 *
 * The common prefix and suffix are removed first, which is where almost every
 * real change leaves most of a file. The search over what remains is bounded
 * by `maxEdits`; a change larger than that is a rewrite, and every line in
 * the rewritten span is reported as changed. That can only count a line that
 * did not change, never miss one that did.
 */
export const DEFAULT_MAX_EDITS = 1000;

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** 1-based line numbers of `after` that an edit from `before` inserted or replaced. */
export function changedLines(before: readonly string[], after: readonly string[], maxEdits = DEFAULT_MAX_EDITS): Set<number> {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  const a = before.slice(start, endBefore);
  const b = after.slice(start, endAfter);
  const inserted = insertions(a, b, maxEdits) ?? b.map((_, i) => i);
  return new Set(inserted.map((i) => start + i + 1));
}

/** Indices of `b` inserted by a shortest edit script from `a`, or undefined when it needs more than `maxEdits` edits. */
function insertions(a: readonly string[], b: readonly string[], maxEdits: number): number[] | undefined {
  const n = a.length;
  const m = b.length;
  if (n === 0) return b.map((_, i) => i);
  if (m === 0) return [];
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  const at = (array: Int32Array, k: number): number => array[k + offset] ?? 0;

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && at(v, k - 1) < at(v, k + 1)) ? at(v, k + 1) : at(v, k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, at);
    }
  }
  return undefined;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number, at: (array: Int32Array, k: number) => number): number[] {
  const inserted: number[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d > 0; d--) {
    const v = trace[d];
    // `trace` holds one array per step, pushed before the step ran; `d` indexes within its length.
    if (v === undefined) break;
    const k = x - y;
    const previousK = k === -d || (k !== d && at(v, k - 1) < at(v, k + 1)) ? k + 1 : k - 1;
    const previousX = at(v, previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x--;
      y--;
    }
    // A step that left x where it was moved down: it inserted b[previousY].
    if (x === previousX) inserted.push(previousY);
    x = previousX;
    y = previousY;
  }
  return inserted.reverse();
}
