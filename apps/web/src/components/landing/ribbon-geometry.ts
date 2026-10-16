export type RibbonDirection = 'h' | 'v';

export interface RibbonPoint {
  x: number;
  y: number;
  dir?: RibbonDirection;
}

interface Segment {
  from: RibbonPoint;
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  to: RibbonPoint;
}

export interface RibbonGeometry {
  d: string;
  length: number;
  /** Path length at each input point, so the ribbon can settle exactly on a landmark. */
  lengthAt: number[];
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Wraps an angle into (-π, π]. */
function wrap(angle: number) {
  let a = angle;
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Heading a `dir` hint locks a point to, facing the way the ribbon travels through it. */
function lockedHeading(points: RibbonPoint[], i: number): number | null {
  const point = points[i]!;
  if (!point.dir) return null;
  const a = points[i - 1] ?? point;
  const b = points[i + 1] ?? point;
  if (point.dir === 'h') return b.x - a.x < 0 ? Math.PI : 0;
  return b.y - a.y < 0 ? -Math.PI / 2 : Math.PI / 2;
}

/** Solves a small dense linear system with partial pivoting. */
function solve(matrix: number[][], rhs: number[]) {
  const n = rhs.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(matrix[row]![col]!) > Math.abs(matrix[pivot]![col]!)) pivot = row;
    }
    [matrix[col], matrix[pivot]] = [matrix[pivot]!, matrix[col]!];
    [rhs[col], rhs[pivot]] = [rhs[pivot]!, rhs[col]!];
    const lead = matrix[col]![col]! || 1e-9;
    for (let row = col + 1; row < n; row++) {
      const factor = matrix[row]![col]! / lead;
      if (!factor) continue;
      for (let k = col; k < n; k++) matrix[row]![k]! -= factor * matrix[col]![k]!;
      rhs[row]! -= factor * rhs[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = rhs[row]!;
    for (let k = row + 1; k < n; k++) sum -= matrix[row]![k]! * x[k]!;
    x[row] = sum / (matrix[row]![row]! || 1e-9);
  }
  return x;
}

/** Hobby's control-handle length for a segment leaving at `theta` and arriving at `phi`. */
function velocity(theta: number, phi: number) {
  const st = Math.sin(theta);
  const sp = Math.sin(phi);
  const ct = Math.cos(theta);
  const cp = Math.cos(phi);
  const numerator = 2 + Math.SQRT2 * (st - sp / 16) * (sp - st / 16) * (ct - cp);
  const denominator = 3 * (1 + 0.5 * (Math.sqrt(5) - 1) * ct + 0.5 * (3 - Math.sqrt(5)) * cp);
  // Keep handles inside the segment so a sharp request bends instead of looping.
  return Math.min(numerator / denominator, 0.66);
}

/**
 * Hobby's algorithm (the curve behind MetaPost and TikZ): it picks each point's heading so the
 * curvature flows continuously from one segment into the next, which reads as one even, drawn
 * line rather than a chain of separate bends. A `dir` hint fixes the heading horizontal or
 * vertical at that point; the open ends use a natural "curl".
 *
 * Unknowns: θ_k, the outgoing angle from chord k at point k (k < n), and φ_n, the arrival angle
 * at the last point. φ_k for interior points follows from θ_k + φ_k = -ψ_k (ψ_k: turn between
 * chords).
 */
function segments(points: RibbonPoint[]): Segment[] {
  const n = points.length - 1;
  const chord = (k: number) => ({
    x: points[k + 1]!.x - points[k]!.x,
    y: points[k + 1]!.y - points[k]!.y,
  });
  const d: number[] = [];
  const alpha: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = chord(k);
    d.push(Math.max(Math.hypot(c.x, c.y), 1e-3));
    alpha.push(Math.atan2(c.y, c.x));
  }
  const psi = (k: number) => (k > 0 && k < n ? wrap(alpha[k]! - alpha[k - 1]!) : 0);
  const locked = points.map((_, i) => lockedHeading(points, i));

  const size = n + 1;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);

  // Start: a locked heading, or curl (equal mock curvature at both ends of the first segment).
  if (locked[0] !== null) {
    matrix[0]![0] = 1;
    rhs[0] = wrap(locked[0]! - alpha[0]!);
  } else if (n > 1) {
    matrix[0]![0] = 1;
    matrix[0]![1] = 1;
    rhs[0] = -psi(1);
  } else {
    matrix[0]![0] = 1;
    matrix[0]![1] = -1;
  }

  // Interior: equal mock curvature arriving at and leaving each point.
  for (let k = 1; k < n; k++) {
    if (locked[k] !== null) {
      matrix[k]![k] = 1;
      rhs[k] = wrap(locked[k]! - alpha[k]!);
      continue;
    }
    matrix[k]![k - 1] = 1 / d[k - 1]!;
    matrix[k]![k] = -2 * (1 / d[k - 1]! + 1 / d[k]!);
    matrix[k]![k + 1] = k + 1 < n ? 1 / d[k]! : -1 / d[k]!;
    rhs[k] = (2 * psi(k)) / d[k - 1]! - (k + 1 < n ? psi(k + 1) / d[k]! : 0);
  }

  // End: a locked heading, or curl.
  if (locked[n] !== null) {
    matrix[n]![n] = 1;
    rhs[n] = wrap(alpha[n - 1]! - locked[n]!);
  } else {
    matrix[n]![n] = 1;
    matrix[n]![n - 1] = -1;
  }

  const x = solve(matrix, rhs);
  const result: Segment[] = [];
  for (let k = 0; k < n; k++) {
    const from = points[k]!;
    const to = points[k + 1]!;
    const theta = x[k]!;
    const phi = k + 1 < n ? -psi(k + 1) - x[k + 1]! : x[n]!;
    const c = chord(k);
    const a = velocity(theta, phi);
    const b = velocity(phi, theta);
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const cp = Math.cos(-phi);
    const sp = Math.sin(-phi);
    result.push({
      from,
      c1: { x: from.x + a * (c.x * ct - c.y * st), y: from.y + a * (c.x * st + c.y * ct) },
      c2: { x: to.x - b * (c.x * cp - c.y * sp), y: to.y - b * (c.x * sp + c.y * cp) },
      to,
    });
  }
  return result;
}

function point(part: Segment, t: number) {
  const { from, c1, c2, to } = part;
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  };
}

function bezierLength(part: Segment) {
  let length = 0;
  let previous = part.from as { x: number; y: number };
  for (let step = 1; step <= 32; step++) {
    const next = point(part, step / 32);
    length += Math.hypot(next.x - previous.x, next.y - previous.y);
    previous = next;
  }
  return length;
}

/** Smooth path through every point, plus cumulative lengths for scroll-settled reveals. */
export function ribbonGeometry(points: RibbonPoint[]): RibbonGeometry | null {
  if (points.length < 2) return null;
  const parts = segments(points);
  const lengthAt = [0];
  let d = `M${round(points[0]!.x)} ${round(points[0]!.y)}`;
  for (const part of parts) {
    d += `C${round(part.c1.x)} ${round(part.c1.y)} ${round(part.c2.x)} ${round(part.c2.y)} ${round(part.to.x)} ${round(part.to.y)}`;
    lengthAt.push(lengthAt[lengthAt.length - 1]! + bezierLength(part));
  }
  return { d, length: lengthAt[lengthAt.length - 1]!, lengthAt };
}
