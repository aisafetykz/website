// The eagle as a halftone: points on a rotated regular grid, kept where they
// fall inside a soaring golden eagle seen from below. It is built feather by
// feather: seven slotted primaries fanned like fingers, a row of secondaries
// whose tips scallop the trailing edge, rows of underwing coverts, a fanned
// tail with a dark terminal band, golden feathered legs (the feet are tucked
// away in flight), and the head turned to one side with a golden nape, an eye and a hooked
// beak, like the eagle on the flag.
//
// Each point carries a tone (0..1, which becomes its dot size), an ink, and
// the feather it belongs to, so the bird can gather and come apart one
// feather at a time.
//
// Local units: wingspan spans x in [-1, 1], head up (+y), tail down (-y).

export const Ink = {
  Plumage: 0, // pale wheat -> gold -> amber -> rust -> deep brown, by tone
  Yellow: 1, // the cere
  Dark: 2, // beak and eye
} as const;
export type Ink = (typeof Ink)[keyof typeof Ink];

// Which part of the bird a point belongs to, so the GPU can articulate it:
// the wings flap and fold, the tail twists and spreads, the head turns.
export const Part = { Body: 0, Head: 1, Wing: 2, Tail: 3 } as const;
export type Part = (typeof Part)[keyof typeof Part];

export type EaglePoint = { x: number; y: number; tone: number; ink: Ink; part: Part; seed: number };

type Vec = [number, number];
type Hit = { tone: number; ink: Ink; group: number; order: number; part?: Part };

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy; // < 1 inside
}

function insidePolygon(x: number, y: number, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Feathers

type Feather = {
  root: Vec;
  dir: Vec; // unit, root -> tip
  len: number;
  width: number; // half width at the base
  notch: number; // where the outer vane narrows (emargination), 1 = none
  narrow: number; // half width after the notch, as a fraction of `width`
  bend: number; // how far the tip curls sideways (+ = left of dir)
};

// Where a point falls on a feather: u along it (0 root, 1 tip), v across
// (-1..1 edge to edge), or null if outside.
function onFeather(x: number, y: number, f: Feather): { u: number; v: number } | null {
  const dx = x - f.root[0];
  const dy = y - f.root[1];
  const along = dx * f.dir[0] + dy * f.dir[1];
  const u = along / f.len;
  if (u < 0 || u > 1) return null;
  const across = -dx * f.dir[1] + dy * f.dir[0] - f.bend * u * u;
  let w = f.width * (u < f.notch ? 1 : 1 - (1 - f.narrow) * smooth(f.notch, f.notch + 0.12, u));
  w *= 1 - 0.18 * u; // a slight taper
  // round tip
  const tipLen = Math.min(w / f.len, 0.2);
  if (u > 1 - tipLen) {
    const k = (u - (1 - tipLen)) / tipLen;
    w *= Math.sqrt(Math.max(0, 1 - k * k));
  }
  if (Math.abs(across) >= w) return null;
  return { u, v: across / w };
}

// Shading shared by all flight feathers: darker toward the edges so each
// feather reads as its own rounded vane, a light shaft down the middle.
function vane(v: number): number {
  const edge = smooth(0.55, 1, Math.abs(v));
  const shaft = 1 - smooth(0.04, 0.16, Math.abs(v));
  return 0.22 * edge - 0.18 * shaft;
}

// --- right wing (x > 0); the left mirrors it ---

const SHOULDER = 0.07;
const WRIST: Vec = [0.56, 0.215];

function leadingY(x: number): number {
  const t = clamp((x - SHOULDER) / (WRIST[0] - SHOULDER));
  return 0.15 + 0.065 * (1 - (1 - t) * (1 - t));
}
function chord(x: number): number {
  const t = clamp((x - SHOULDER) / (WRIST[0] - SHOULDER));
  return 0.29 + 0.1 * Math.sin(Math.PI * Math.min(1, t * 1.05)) - 0.02 * t;
}
const COVERT_DEPTH = 0.165; // how far the coverts reach back from the leading edge

const SECONDARIES: Feather[] = Array.from({ length: 12 }, (_, i) => {
  const x = 0.085 + i * 0.041;
  const top = leadingY(x) - 0.06;
  const tip: Vec = [x + 0.012, leadingY(x) - chord(x)];
  const len = Math.hypot(tip[0] - x, tip[1] - top);
  return {
    root: [x, top],
    dir: [(tip[0] - x) / len, (tip[1] - top) / len],
    len,
    width: 0.03,
    notch: 1,
    narrow: 1,
    bend: 0,
  };
});

const PIVOT: Vec = [0.6, 0.135];
const PRIMARIES: Feather[] = [
  // inner -> outer: angle (deg, 0 = +x), length, base half width
  [-48, 0.31, 0.056],
  [-36, 0.35, 0.055],
  [-24, 0.39, 0.053],
  [-13, 0.42, 0.05],
  [-3, 0.43, 0.047],
  [7, 0.41, 0.043],
  [16, 0.35, 0.038],
].map(([deg, len, width], i) => {
  const a = (deg * Math.PI) / 180;
  const dir: Vec = [Math.cos(a), Math.sin(a)];
  // roots spread a little along the hand
  const root: Vec = [PIVOT[0] - 0.035 + i * 0.012, PIVOT[1] + 0.012 * i - 0.02];
  return { root, dir, len, width, notch: i === 0 ? 1 : 0.64, narrow: 0.42, bend: 0.025 };
});

// The underwing coverts: from the shoulder along the leading edge to the wrist,
// then round the hand over the bases of the primaries.
const COVERTS: Vec[] = (() => {
  const pts: Vec[] = [];
  for (let i = 0; i <= 24; i++) {
    const x = SHOULDER + (i / 24) * (WRIST[0] - SHOULDER);
    pts.push([x, leadingY(x)]);
  }
  pts.push([0.62, 0.225], [0.69, 0.215], [0.735, 0.19]); // over the hand
  pts.push([0.73, 0.12], [0.68, 0.06], [0.62, 0.03]);
  for (let i = 24; i >= 0; i--) {
    const x = SHOULDER + (i / 24) * (WRIST[0] - SHOULDER);
    const depth = COVERT_DEPTH * (0.75 + 0.25 * Math.sin((i / 24) * Math.PI));
    pts.push([x, leadingY(x) - depth]);
  }
  return pts;
})();

function wing(x: number, y: number): Hit | null {
  const ax = x;

  // Coverts: dark, laid in overlapping rows like roof tiles.
  if (insidePolygon(x, y, COVERTS)) {
    const back = clamp((leadingY(Math.min(x, WRIST[0])) - y) / COVERT_DEPTH);
    const row = Math.floor(back * 3.4);
    const rowT = back * 3.4 - row;
    const across = (ax * 17 + row * 0.5) % 1; // stagger alternate rows
    const scallop = Math.abs(across - 0.5) * 2; // 0 middle of a covert, 1 its side
    const edge = smooth(0.6, 1, rowT + 0.55 * scallop * scallop);
    const marginal = 1 - smooth(0, 0.12, back); // lighter rim along the leading edge
    return {
      tone: 0.64 + 0.3 * edge - 0.24 * marginal,
      ink: Ink.Plumage,
      group: 100 + row * 40 + Math.floor(ax * 17 + row * 0.5),
      order: 0.3 + 0.35 * ax,
    };
  }

  // Primaries, outer on top.
  for (let i = PRIMARIES.length - 1; i >= 0; i--) {
    const hit = onFeather(x, y, PRIMARIES[i]);
    if (!hit) continue;
    const { u, v } = hit;
    // pale bases on the inner primaries (a window by the wrist), then
    // barring, then dark fingertips
    const pale = (1 - smooth(0.25, 0.45, u)) * (1 - smooth(1, 4, i));
    const bars = 0.12 * smooth(0.6, 1, Math.sin(u * 30 + i));
    const tip = smooth(0.62, 0.82, u);
    return {
      tone: 0.55 - 0.22 * pale + 0.37 * tip + bars * (1 - tip) + vane(v),
      ink: Ink.Plumage,
      group: 10 + i,
      order: 0.72 + 0.04 * i,
    };
  }

  // Secondaries, outer on top.
  for (let i = SECONDARIES.length - 1; i >= 0; i--) {
    const hit = onFeather(x, y, SECONDARIES[i]);
    if (!hit) continue;
    const { u, v } = hit;
    const window = smooth(0.25, 0.5, ax) * (1 - smooth(0.25, 0.45, u)); // golden bases toward the wrist
    const bars = 0.12 * smooth(0.55, 1, Math.sin(u * 24 + i * 0.7));
    const band = smooth(0.8, 0.92, u); // dark trailing edge
    return {
      tone: 0.52 - 0.2 * window + bars * (1 - band) + 0.38 * band + vane(v),
      ink: Ink.Plumage,
      group: 30 + i,
      order: 0.45 + 0.4 * ax,
    };
  }
  return null;
}

// --- tail ---

const TAIL_PIVOT: Vec = [0, -0.04];
const TAIL: Feather[] = Array.from({ length: 12 }, (_, i) => {
  const k = (i - 5.5) / 5.5; // -1..1 across the fan
  const a = -Math.PI / 2 + k * 0.36;
  const len = 0.46 - 0.035 * k * k;
  return {
    root: [TAIL_PIVOT[0] + Math.cos(a) * 0.08, TAIL_PIVOT[1] + Math.sin(a) * 0.08],
    dir: [Math.cos(a), Math.sin(a)],
    len: len - 0.08,
    width: 0.034,
    notch: 1,
    narrow: 1,
    bend: 0,
  };
});

function tail(x: number, y: number): Hit | null {
  // centre feathers on top, so the edges overlap outward
  const order = TAIL.map((_, i) => i).sort((a, b) => Math.abs(a - 5.5) - Math.abs(b - 5.5));
  for (const i of order) {
    const hit = onFeather(x, y, TAIL[i]);
    if (!hit) continue;
    const { u, v } = hit;
    const band = smooth(0.6, 0.68, u); // broad dark terminal band
    const tipLight = smooth(0.94, 1, u) * 0.3; // a thin pale fringe at the very end
    if (band < 0.5) {
      // pale where it leaves the coverts, warming to gold, with soft bars
      const bar = 0.16 * smooth(0.3, 1, Math.sin(u * 34 + 1.2));
      return { tone: 0.12 + 0.4 * u + bar + vane(v) * 0.7, ink: Ink.Plumage, group: 60 + i, order: 0.18 };
    }
    return { tone: 0.88 - tipLight + vane(v) * 0.6, ink: Ink.Plumage, group: 60 + i, order: 0.18 };
  }
  return null;
}

// --- body, legs, feet, head ---

const BEAK: Vec[] = [
  [0.085, 0.352],
  [0.125, 0.358],
  [0.16, 0.344],
  [0.182, 0.32],
  [0.179, 0.292], // the hook
  [0.168, 0.302],
  [0.152, 0.311],
  [0.12, 0.308],
  [0.085, 0.31],
];

function body(x: number, y: number): Hit | null {
  // Eye: dark pupil in an amber ring.
  const eye = ellipse(x, y, 0.056, 0.343, 0.019, 0.017);
  if (eye < 1) return { tone: eye < 0.4 ? 0.95 : 0.55, ink: eye < 0.4 ? Ink.Dark : Ink.Plumage, group: 1, order: 0 };
  // Brow: a dark ridge over the eye that gives eagles their stare.
  if (ellipse(x, y, 0.06, 0.366, 0.036, 0.009) < 1) return { tone: 0.95, ink: Ink.Plumage, group: 1, order: 0 };

  // Beak with a yellow cere at its base.
  if (insidePolygon(x, y, BEAK)) {
    if (x < 0.11) return { tone: 0.85, ink: Ink.Yellow, group: 1, order: 0 };
    return { tone: 0.75 + 0.25 * smooth(0.13, 0.17, x), ink: Ink.Dark, group: 1, order: 0 };
  }

  // Head: golden nape and crown, darker toward the face.
  const head = ellipse(x, y, 0.016, 0.33, 0.088, 0.082);
  if (head < 1) {
    const face = smooth(0.0, 0.09, x);
    const streak = 0.1 * smooth(0.6, 1, Math.sin(x * 120 + y * 70));
    const outline = 0.3 * smooth(0.72, 1, head);
    return { tone: 0.34 + 0.32 * face + streak + outline, ink: Ink.Plumage, group: 1, order: 0 };
  }

  // Undertail coverts, lighter, over the base of the tail.
  const utc = ellipse(x, y, 0, -0.12, 0.072, 0.075);
  if (utc < 1) {
    const scallop = smooth(0.5, 1, Math.abs(Math.sin(x * 70) * Math.sin(y * 70)));
    return { tone: 0.5 + 0.18 * scallop + 0.15 * utc, ink: Ink.Plumage, group: 3, order: 0.1 };
  }

  // Feathered legs ("trousers"), golden.
  for (const s of [-1, 1]) {
    const leg = ellipse(x, y, s * 0.048, -0.05, 0.04, 0.085);
    if (leg < 1) {
      const fluff = 0.1 * smooth(0.5, 1, Math.sin(y * 90 + s * x * 40));
      return { tone: 0.42 + fluff + 0.2 * leg, ink: Ink.Plumage, group: 4, order: 0.06 };
    }
  }

  // Body: dark breast, finely streaked, rounded with a little shading.
  const neck = ellipse(x, y, 0.004, 0.235, 0.07, 0.07);
  const torso = ellipse(x, y, 0, 0.07, 0.102, 0.215);
  if (torso < 1 || neck < 1) {
    const r = Math.min(torso, neck);
    const streak = 0.1 * smooth(0.55, 1, Math.sin(x * 110 + Math.sin(y * 30) * 2));
    const throat = smooth(0.18, 0.27, y) * 0.18; // lighter, toward the golden head
    return { tone: 0.68 + streak + 0.2 * r - throat, ink: Ink.Plumage, group: 5, order: 0.04 };
  }
  return null;
}

function classify(x: number, y: number): Hit | null {
  const b = body(x, y);
  if (b) return { ...b, part: b.group === 1 ? Part.Head : Part.Body };
  const w = wing(Math.abs(x), y);
  if (w) return { ...w, group: w.group + (x < 0 ? 1000 : 0), part: Part.Wing };
  const t = tail(x, y);
  return t && { ...t, part: Part.Tail };
}

/** Deterministic halftone sampling of the eagle. */
export function eaglePoints(spacing = 0.0095, angleDeg = 45): EaglePoint[] {
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
      if (Math.abs(x) > 1.05 || y > 0.45 || y < -0.55) continue;
      const hit = classify(x, y);
      if (!hit) continue;
      // Body first, wingtips last; each feather keeps one seed so it moves as a unit.
      const s = clamp(0.62 * hit.order + 0.28 * hash(hit.group) + 0.1 * rand(), 0, 0.999);
      pts.push({ x, y, tone: clamp(hit.tone, 0.08, 1), ink: hit.ink, part: hit.part ?? Part.Body, seed: s });
    }
  }
  return pts;
}

/** Quick text preview for tuning the silhouette in a terminal. */
export function eagleAscii(cols = 110, rows = 40): string {
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
