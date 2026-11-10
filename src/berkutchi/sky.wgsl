// The steppe printed as halftone ink on warm paper: the 36-ray sun from the
// flag, a far mountain ridge with snow left as bare paper, and tulips across the
// grass. Every dot takes the ink and tone of the scene at its cell centre, so
// the whole background shares one print-like grid.

struct Sky {
  resolution: vec2f, // device pixels
  sun: vec2f,        // world units
  time: f32,
  cell: f32,         // halftone cell size in device pixels
  horizon: f32,      // world y of the steppe line
  glow: f32,         // 0..1, how together the eagle is; strengthens the sun
  sunScale: f32,     // smaller sun on portrait screens
}
@group(0) @binding(0) var<uniform> sky: Sky;

const PAPER = vec3f(1.0, 0.969, 0.957); // #fff7f4
const INK = vec3f(0.114, 0.31, 0.612);  // deep blue
const SKY = vec3f(0.44, 0.6, 0.83);     // light blue
const GOLD = vec3f(0.95, 0.68, 0.12);
const AMBER = vec3f(0.89, 0.5, 0.15);
const TERRA = vec3f(0.78, 0.3, 0.17);
const OCHRE = vec3f(0.82, 0.63, 0.34);

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Ridge line of the far mountains.
fn ridge(x: f32) -> f32 {
  let a = 0.5 + 0.5 * sin(x * 1.7 + 0.6);
  let b = 0.5 + 0.5 * sin(x * 4.3 + 2.1);
  let c = abs(sin(x * 9.1 + 0.4));
  return sky.horizon + 0.05 + 0.12 * a * a + 0.05 * b + 0.022 * c;
}

fn groundLine(x: f32) -> f32 {
  return sky.horizon + 0.018 * sin(x * 1.3 + 1.0) + 0.01 * sin(x * 3.7);
}

struct Ink { color: vec3f, tone: f32 }

fn scene(q: vec2f, cellId: vec2f) -> Ink {
  let ground = groundLine(q.x);

  // Steppe: ochre grass, denser toward the viewer, with tulips.
  if (q.y < ground) {
    let depth = clamp((ground - q.y) / 0.45, 0.0, 1.0);
    var ink = Ink(mix(OCHRE, AMBER, 0.3 * depth), 0.06 + 0.2 * depth);
    let h = hash(cellId);
    let clump = 0.5 + 0.5 * sin(q.x * 3.0 + 1.3) * sin(q.x * 1.1 - q.y * 7.0);
    if (h > 1.0 - 0.2 * depth * clump) {
      let pick = hash(cellId + 7.0);
      ink.color = select(select(GOLD, TERRA, pick > 0.6), AMBER, pick < 0.3);
      ink.tone = 0.6 + 0.3 * depth;
    }
    return ink;
  }

  // Far mountains in blue; the peaks stay bare paper, like snow.
  let top = ridge(q.x);
  if (q.y < top) {
    let snow = smoothstep(top - 0.07, top - 0.02, q.y) * smoothstep(sky.horizon + 0.12, sky.horizon + 0.2, top);
    let base = smoothstep(sky.horizon, top, q.y); // lighter toward the peaks
    return Ink(mix(mix(INK, SKY, 0.5 * base), SKY, snow), mix(0.42 - 0.2 * base, 0.12, snow));
  }

  // Sky: ink gathers toward the zenith and thins near the horizon,
  // with a warm wash low down around the sun.
  let h = clamp((q.y - sky.horizon) / 1.6, 0.0, 1.0);
  var ink = Ink(mix(SKY, INK, h * 0.5), 0.008 + 0.11 * pow(h, 1.9));
  let warm = exp(-pow((q.x - sky.sun.x) / 1.3, 2.0)) * pow(1.0 - h, 3.0);
  ink.color = mix(ink.color, AMBER, clamp(warm * 0.8, 0.0, 0.7));
  ink.tone += 0.05 * warm;

  // Sun: disc, a thin gap, then 36 rays that slowly turn.
  let d = q - sky.sun;
  let r = length(d);
  let R = 0.17 * sky.sunScale;
  let outer = 0.78 * sky.sunScale;
  let shine = 0.75 + 0.25 * sky.glow;
  if (r < R) {
    return Ink(GOLD, 0.85 * shine);
  }
  if (r < R + 0.035) {
    return Ink(GOLD, 0.0);
  }
  if (r < outer) {
    let theta = atan2(d.y, d.x) + sky.time * 0.015;
    let ray = smoothstep(0.45, 1.0, 0.5 + 0.5 * cos(theta * 36.0));
    let fall = pow(1.0 - (r - R - 0.035) / (outer - R - 0.035), 1.4);
    let t = ray * fall * 0.8 * shine;
    if (t > ink.tone * 0.5) {
      return Ink(mix(AMBER, GOLD, fall), max(ink.tone * (1.0 - ray), t));
    }
    // Clear the sky a little between rays so the sun reads as light.
    ink.tone *= 1.0 - 0.6 * fall;
  }
  return ink;
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let px = uv * sky.resolution;
  let aspect = sky.resolution.x / sky.resolution.y;

  // Rotated halftone grid in pixel space.
  let c = 0.70710678;
  let rot = mat2x2f(c, -c, c, c);
  let g = rot * px / sky.cell;
  let id = floor(g) + 0.5;
  let local = g - id;
  let centre = transpose(rot) * id * sky.cell;

  // Sample the scene at the cell centre so each dot is one flat tone.
  let cuv = centre / sky.resolution;
  let q = vec2f((cuv.x * 2.0 - 1.0) * aspect, 1.0 - cuv.y * 2.0);
  let ink = scene(q, id);

  let radius = 0.62 * sqrt(clamp(ink.tone, 0.0, 1.0));
  let aa = 1.2 / sky.cell;
  let cover = 1.0 - smoothstep(radius - aa, radius + aa, length(local));
  return vec4f(mix(PAPER, ink.color, cover), 1.0);
}
