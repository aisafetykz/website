// The eagle as a halftone: points on a rotated regular grid, kept where they
// fall inside a soaring golden-eagle silhouette seen from below (wings spread,
// fingered primaries, fanned tail, head turned to one side like the eagle on
// the flag). Each point carries a tone (0..1) that becomes its dot size.
//
// Local units: wingspan spans x in [-1, 1], head up (+y), tail down (-y).

export type EaglePoint = { x: number; y: number; tone: number; seed: number };

type Vec = [number, number];

function insidePolygon(x: number, y: number, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy; // < 1 inside
}

// Distance from a point to a segment, for the finger-like primaries.
function segDist(x: number, y: number, a: Vec, b: Vec): { d: number; t: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)));
  return { d: Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t), t };
}

// One wing (right side, x > 0). Leading edge rises slightly toward the wrist;
// the trailing edge is broad and scalloped by the secondaries.
function wingPolygon(): Vec[] {
  const pts: Vec[] = [];
  // leading edge: shoulder -> wrist
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = 0.05 + t * 0.66;
    const y = 0.1 + 0.1 * Math.sin(t * Math.PI * 0.85) + 0.04 * t;
    pts.push([x, y]);
  }
  // hand: wrist down to where the primaries start
  pts.push([0.75, 0.17]);
  pts.push([0.77, -0.04]);
  // trailing edge back toward the body, scalloped
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = 0.74 - t * 0.69;
    const bulge = -0.07 - 0.14 * Math.sin(Math.PI * (0.3 + 0.7 * t)); // broad secondaries
    const scallop = 0.018 * Math.abs(Math.sin(t * Math.PI * 9));
    pts.push([x, bulge + scallop]);
  }
  pts.push([0.05, -0.1]);
  return pts;
}

const WING = wingPolygon();
const WING_L: Vec[] = WING.map(([x, y]) => [-x, y]);

// Primaries spread like fingers from the hand.
const FINGERS: { a: Vec; b: Vec; w: number }[] = [0, 1, 2, 3, 4, 5].map((i) => {
  const ang = 0.42 - i * 0.16; // fan from slightly up to slightly down
  const len = 0.28 - Math.abs(i - 2) * 0.025;
  const a: Vec = [0.72, 0.17 - i * 0.04];
  return { a, b: [a[0] + Math.cos(ang) * len, a[1] + Math.sin(ang) * len], w: 0.026 - i * 0.0012 };
});

type Part = "body" | "head" | "beak" | "wing" | "finger" | "tail";

function classify(x: number, y: number): { part: Part; tone: number } | null {
  const ax = Math.abs(x);

  // Head turned to the right, with a hooked beak
  if (ellipse(x, y, 0.012, 0.29, 0.065, 0.07) < 1) {
    return { part: "head", tone: 0.42 }; // golden nape: lighter
  }
  const beak: Vec[] = [
    [0.06, 0.32],
    [0.13, 0.305],
    [0.135, 0.272],
    [0.115, 0.284],
    [0.06, 0.27],
  ];
  if (insidePolygon(x, y, beak)) return { part: "beak", tone: 0.85 };

  // Body
  const b = ellipse(x, y, 0, 0.02, 0.085, 0.25);
  if (b < 1) return { part: "body", tone: 0.62 + 0.3 * b };

  // Tail: a short rounded fan
  if (y < -0.12 && y > -0.5) {
    const t = (-0.12 - y) / 0.38;
    const half = 0.06 + t * 0.1;
    const roundEnd = y > -0.42 || ellipse(x, y, 0, -0.44, half, 0.06) < 1;
    if (ax < half && roundEnd) {
      const bars = 0.12 * (Math.sin(t * Math.PI * 7) > 0.6 ? 1 : 0); // banded tail
      return { part: "tail", tone: 0.55 + 0.2 * t + bars };
    }
  }

  // Wings
  if (insidePolygon(x, y, x > 0 ? WING : WING_L)) {
    // coverts lighter near the leading edge, darker flight feathers behind
    const lead = 0.1 + 0.1 * Math.sin(((ax - 0.05) / 0.66) * Math.PI * 0.85);
    const depth = Math.max(0, Math.min(1, (lead - y) / 0.3));
    const featherLines = 0.12 * Math.pow(Math.abs(Math.sin(ax * 70)), 6) * depth;
    const shoulder = 0.12 * Math.max(0, 1 - ax / 0.25);
    return { part: "wing", tone: 0.38 + 0.42 * depth + featherLines + shoulder };
  }

  // Fingered primaries
  for (const f of FINGERS) {
    const fa: Vec = x > 0 ? f.a : [-f.a[0], f.a[1]];
    const fb: Vec = x > 0 ? f.b : [-f.b[0], f.b[1]];
    const { d, t } = segDist(x, y, fa, fb);
    const w = f.w * (1 - 0.55 * t * t);
    if (d < w) return { part: "finger", tone: 0.82 + 0.15 * t };
  }
  return null;
}

/** Deterministic halftone sampling of the eagle. */
export function eaglePoints(spacing = 0.0125, angleDeg = 45): EaglePoint[] {
  const a = (angleDeg * Math.PI) / 180;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const pts: EaglePoint[] = [];
  let seed = 1;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const n = Math.ceil(1.6 / spacing);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const u = i * spacing;
      const v = j * spacing;
      const x = u * ca - v * sa;
      const y = u * sa + v * ca + 0.02;
      if (Math.abs(x) > 1.05 || y > 0.4 || y < -0.55) continue;
      const hit = classify(x, y);
      if (!hit) continue;
      pts.push({ x, y, tone: Math.max(0.12, Math.min(1, hit.tone)), seed: rand() });
    }
  }
  return pts;
}

/** Quick text preview for tuning the silhouette in a terminal. */
export function eagleAscii(cols = 100, rows = 34): string {
  const ramp = " .:-=+*#%@";
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * 2.2 - 1.1;
      const y = 0.45 - ((r + 0.5) / rows) * 1.0;
      const hit = classify(x, y);
      line += hit ? ramp[Math.min(9, Math.round(hit.tone * 9))] : " ";
    }
    out.push(line.replace(/\s+$/, ""));
  }
  return out.join("\n");
}
