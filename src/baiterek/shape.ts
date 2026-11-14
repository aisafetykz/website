// The Baiterek tower, drawn as a coverage map for the shader to set in
// numbers. Red holds the white steel (trunk, branches, rings), green the
// golden sphere. The drawing is kept bold and plain: everything in it has to
// survive being made of characters.
//
// Tower units: x = 0 is the axis and x = ±1 the widest branch tips; y = 0 is
// the highest tip and grows downward. The trunk runs on past any y asked for.

export const HALF_WIDTH = 1.12; // of the map, in tower units
export const HEADROOM = 0.1; // above the highest tip
export const TRUNK = 0.42; // half the trunk's width near the ground, roughly
export const SPHERE = { x: 0, y: 0.67, r: 0.58 };

// Branch tips, left to right around the crown.
export const TIPS: [number, number][] = [
  [-0.95, 0.92],
  [-0.99, 0.66],
  [-0.875, 0.375],
  [-0.61, 0.14],
  [-0.22, 0],
  [0.22, 0.005],
  [0.61, 0.125],
  [0.885, 0.375],
  [1, 0.65],
  [0.95, 0.93],
];

type Point = [number, number];

// A branch leaves the trunk almost straight up, then leans out to its tip.
function branch([tx, ty]: Point, t: number): Point {
  const a: Point = [tx * 0.36, 2.5];
  const c: Point = [tx * 0.42, 1.15 + ty * 0.5];
  const u = 1 - t;
  return [u * u * a[0] + 2 * u * t * c[0] + t * t * tx, u * u * a[1] + 2 * u * t * c[1] + t * t * ty];
}

// Half the trunk's width: narrowest at the waist, wider toward the ground and
// where it opens into the branches.
function trunk(y: number) {
  const d = y - 2.6;
  return d > 0 ? 0.365 + 0.035 * (d / 1.6) ** 2 : 0.365 + 0.05 * (d / 0.5) ** 2;
}

const steel = (alpha: number) => `rgba(255, 0, 0, ${alpha})`;
const gold = (alpha: number) => `rgba(0, 255, 0, ${alpha})`;

/**
 * Draws the tower into `ctx`, down to `yMax` tower units. `sx` and `sy` are
 * map pixels per tower unit; they differ because text cells are not square.
 * `stroke` is the thinnest a line may be and still hold an unbroken run of cells.
 */
export function drawBaiterek(ctx: CanvasRenderingContext2D, sx: number, sy: number, yMax: number, stroke: number) {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.setTransform(sx, 0, 0, sy, HALF_WIDTH * sx, HEADROOM * sy);
  ctx.lineCap = "round";

  // The sphere, brightest at the upper left.
  const light = ctx.createRadialGradient(SPHERE.x - 0.2, SPHERE.y - 0.25, 0.05, SPHERE.x, SPHERE.y, SPHERE.r);
  light.addColorStop(0, gold(1));
  light.addColorStop(1, gold(0.72));
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(SPHERE.x, SPHERE.y, SPHERE.r, 0, Math.PI * 2);
  ctx.fill();

  // The steel adds up where it crosses.
  ctx.globalCompositeOperation = "lighter";

  // The trunk.
  const top = 2.2;
  ctx.beginPath();
  for (let y = top; y <= yMax + 0.05; y += 0.05) ctx.lineTo(-trunk(y), y);
  for (let y = yMax + 0.05; y >= top; y -= 0.05) ctx.lineTo(trunk(y), y);
  ctx.closePath();
  ctx.fillStyle = steel(1);
  ctx.fill();

  // The deck around the sphere, and one hoop lower in the crown.
  ctx.strokeStyle = steel(1);
  ctx.lineWidth = stroke;
  for (const [y, rx, ry] of [
    [0.88, 0.63, 0.06],
    [1.62, 0.4, 0.035],
  ]) {
    ctx.beginPath();
    ctx.ellipse(0, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // The branches, tapering toward their tips.
  const steps = 32;
  for (const tip of TIPS) {
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      ctx.lineWidth = stroke * (1 + (1 - t) ** 2);
      ctx.beginPath();
      ctx.moveTo(...branch(tip, t));
      ctx.lineTo(...branch(tip, t + 1 / steps));
      ctx.stroke();
    }
  }
}
