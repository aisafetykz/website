// One thread per particle. Each eagle particle has a home on the bird, which
// is posed in 3D every frame: the wings flap from the shoulder with the hand
// lagging behind, twist on the downstroke, fold on the upstroke and bend at
// the tips under load; the tail twists and spreads to steer; the head turns.
// The whole bird then rolls, pitches and yaws, and is seen in perspective
// from below, so near feathers grow and far ones shrink.
//
// How strongly a particle holds its place depends on `cohesion`, staggered
// per feather so the bird assembles and dissolves feather by feather. Loose
// particles ride a wind field across the steppe. Ambient motes (tone < 0)
// always drift.

struct Particle {
  home: vec2f, // position on the eagle's planform (span x, head +y)
  tone: f32,   // 0..1 dot weight + 2 * ink + 8 * part; negative for ambient motes
  seed: f32,
}

struct Params {
  center: vec2f,
  pointer: vec2f,
  kickAt: vec2f, // where the last click landed, world units
  kickNow: f32,  // 1 on the frame of a click: blow nearby particles outward
  kick: f32,     // 1 right after a click, easing to 0: loosens the eagle's hold
  time: f32,
  dt: f32,
  aspect: f32,
  cohesion: f32,
  scale: f32,
  flap: f32,       // wingbeat phase, radians
  flapAmp: f32,    // wingbeat amplitude at the shoulder, radians
  pointerOn: f32,
  dotSize: f32,    // device pixels
  count: u32,
  yaw: f32,        // turn in the picture plane
  pitch: f32,      // head away from (+) or toward (-) the viewer
  roll: f32,       // bank: one wing toward the viewer, the other away
  dihedral: f32,   // the shallow V a soaring eagle holds its wings in
  gust: f32,       // extra upward flex of the hand from the air
  tailTwist: f32,
  tailSpread: f32,
  headTurn: f32,   // -1 beak to the left, 0 toward the viewer, 1 to the right
  bob: f32,        // the body rises and falls against the wingbeat
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> state: array<vec4f>; // pos.xy, vel.xy
@group(0) @binding(3) var<storage, read_write> sprites: array<vec4f>; // pos.xy, size px, tone (+8 if seen from above)

const SHOULDER = 0.07; // planform x where the wing meets the body
const ARM = 0.49;      // shoulder to wrist
const EYE = 3.4;       // camera distance, in planform units; smaller = stronger perspective
const LIGHT = vec3f(-0.35, 0.55, 0.76);

fn wind(p: vec2f, t: f32, seed: f32) -> vec2f {
  let a = sin(p.x * 1.3 + t * 0.21 + seed * 2.0) + cos(p.y * 2.1 - t * 0.17) + 0.6 * sin((p.x + p.y) * 3.7 + seed * 6.0);
  return vec2f(0.11 + 0.05 * cos(a * 1.7), 0.06 * sin(a * 2.3));
}

// A point on the bird in 3D: x span, y toward the head, z toward the viewer
// (the eagle is overhead, so its belly faces us). n is the surface normal on
// the belly side.
struct Pose {
  p: vec3f,
  n: vec3f,
}

fn wingPose(home: vec2f) -> Pose {
  let side = select(-1.0, 1.0, home.x >= 0.0);
  let r = max(abs(home.x) - SHOULDER, 0.0);
  let a = params.flapAmp;
  let ph = params.flap - 1.0 * r; // the wingbeat travels out toward the tip
  let lift = sin(ph);             // +1 at the top of the stroke
  let down = -cos(ph);            // > 0 while the wing sweeps down
  let theta1 = params.dihedral + a * lift;

  // The hand lags the arm, bends up under load, and tucks in on the upstroke.
  let tip = smoothstep(0.0, 0.42, r - ARM);
  let theta2 = a * 0.5 * sin(ph - 0.9) + (params.gust + 0.35 * a * max(down, 0.0)) * tip;
  let fold = 1.0 - 0.3 * clamp(a / 0.6, 0.0, 1.0) * max(0.0, -down);

  var x = 0.0;
  var z = 0.0;
  var th = theta1;
  if (r <= ARM) {
    x = SHOULDER + r * cos(theta1);
    z = -r * sin(theta1);
  } else {
    let rh = (r - ARM) * fold;
    th = theta1 + theta2;
    x = SHOULDER + ARM * cos(theta1) + rh * cos(th);
    z = -(ARM * sin(theta1) + rh * sin(th));
  }
  // Twist: on the downstroke the leading edge dips and the trailing edge lifts.
  let twist = 0.45 * a * down * min(1.0, r / 0.5);
  z += (home.y - 0.16) * twist;
  return Pose(vec3f(side * x, home.y, z), normalize(vec3f(side * sin(th), -twist * 0.5, cos(th))));
}

fn tailPose(home: vec2f) -> Pose {
  let pivot = vec2f(0.0, -0.1);
  let rel = home - pivot;
  let x = rel.x * params.tailSpread;
  let tw = params.tailTwist;
  let along = max(-rel.y, 0.0);
  let p = vec3f(pivot.x + x * cos(tw), home.y, x * sin(tw) - along * 0.12 * params.pitch);
  return Pose(p, normalize(vec3f(-sin(tw), 0.0, cos(tw))));
}

fn headPose(home: vec2f) -> Pose {
  // The head is drawn in profile, beak to the right. Turning it swings the
  // beak through the viewer (it looks down at you) to the other side.
  let neck = vec2f(0.0, 0.27);
  let rel = home - neck;
  let c = params.headTurn;
  let s = sqrt(max(0.0, 1.0 - c * c));
  let p = vec3f(neck.x + rel.x * c, home.y, 0.035 + abs(rel.x) * s);
  return Pose(p, vec3f(0.0, 0.0, 1.0));
}

fn bodyPose(home: vec2f) -> Pose {
  // The belly bulges toward the viewer.
  let k = clamp(home.x / 0.11, -1.0, 1.0);
  let z = 0.05 * sqrt(max(0.0, 1.0 - k * k));
  return Pose(vec3f(home, z), normalize(vec3f(k * 0.8, 0.0, 1.0)));
}

fn rotate(v: vec3f) -> vec3f {
  // roll about the body's long axis, then pitch about the span, then yaw in the picture
  let cr = cos(params.roll);
  let sr = sin(params.roll);
  var q = vec3f(v.x * cr + v.z * sr, v.y, -v.x * sr + v.z * cr);
  let cp = cos(params.pitch);
  let sp = sin(params.pitch);
  q = vec3f(q.x, q.y * cp - q.z * sp, q.y * sp + q.z * cp);
  let cy = cos(params.yaw);
  let sy = sin(params.yaw);
  return vec3f(q.x * cy - q.y * sy, q.x * sy + q.y * cy, q.z);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= params.count) {
    return;
  }
  let p = particles[i];
  var s = state[i];
  var pos = s.xy;
  var vel = s.zw;
  let start = pos;
  let dt = params.dt;
  let ambient = p.tone < 0.0;

  // Unpack tone + 2 * ink + 8 * part.
  let part = floor(max(p.tone, 0.0) / 8.0);
  let inked = p.tone - 8.0 * part;
  let weight = inked - 2.0 * floor(inked * 0.5);

  // Staggered: low seeds join first and leave last.
  var pc = 0.0;
  if (!ambient) {
    let begin = p.seed * 0.55;
    pc = smoothstep(begin, begin + 0.45, params.cohesion);
    // After a click the hold loosens, so scattered feathers drift before
    // they are pulled home; low seeds return first.
    pc *= 1.0 - 0.92 * smoothstep(p.seed * 0.4, p.seed * 0.4 + 0.6, params.kick);
  }

  // Where this particle belongs on the posed bird, in world units.
  var goal = pos;
  var persp = 1.0;
  var shade = 1.0;
  var facing = 1.0;
  if (!ambient) {
    var pose: Pose;
    if (part == 1.0) {
      pose = headPose(p.home);
    } else if (part == 2.0) {
      pose = wingPose(p.home);
    } else if (part == 3.0) {
      pose = tailPose(p.home);
    } else {
      pose = bodyPose(p.home);
    }
    var q = pose.p;
    q.z += params.bob;
    q.y -= params.bob * 0.6;
    q = rotate(q);
    let n = rotate(pose.n);
    persp = EYE / (EYE - q.z);
    goal = params.center + params.scale * q.xy * persp;
    facing = n.z;
    shade = dot(n, LIGHT);
  }

  var acc = vec2f(0.0);
  if (pc > 0.0) {
    let k = 90.0 * pc;
    acc += (goal - pos) * k - vel * 2.0 * sqrt(max(k, 0.0001));
  }
  let w = wind(pos, params.time, p.seed);
  acc += (w - vel) * 1.6 * (1.0 - pc);

  // The pointer is a gust that pushes particles aside.
  if (params.pointerOn > 0.5) {
    let d = pos - params.pointer;
    let r2 = dot(d, d);
    acc += normalize(d + vec2f(1e-5, 0.0)) * 40.0 * exp(-r2 / 0.02);
  }

  // A click: a burst that throws particles out from where it landed.
  if (params.kickNow > 0.5) {
    let d = pos - params.kickAt;
    let r2 = dot(d, d);
    let spin = vec2f(-d.y, d.x) * (p.seed - 0.5);
    vel += (normalize(d + vec2f(1e-5, 0.0)) * (0.9 + 0.8 * p.seed) + spin * 2.0) * exp(-r2 / 0.35);
  }

  vel += acc * dt;
  pos += vel * dt;

  // Once a feather is home it rides the bird closely, so the wingbeat stays
  // crisp instead of being smoothed away by the spring.
  let snap = 1.0 - exp(-dt * 30.0 * pc * pc * pc);
  pos = mix(pos, goal, snap);
  vel = mix(vel, (pos - start) / max(dt, 1e-4), snap);

  // Loose particles wrap around the sides and stay in the sky.
  let edge = params.aspect + 0.15;
  if (pc < 0.02) {
    if (pos.x > edge) { pos.x -= 2.0 * edge; }
    if (pos.x < -edge) { pos.x += 2.0 * edge; }
    if (pos.y > 1.1) { pos.y = -0.25; }
  }
  pos.y = clamp(pos.y, -0.98, 1.15);

  state[i] = vec4f(pos, vel);

  var size = 0.0;
  var tone = 0.0;
  if (ambient) {
    let twinkle = 0.6 + 0.4 * sin(params.time * (0.8 + p.seed * 1.5) + p.seed * 40.0);
    size = max(2.0, params.dotSize * 0.45) * -p.tone * twinkle;
    tone = -1.0; // marks a mote for the dot shader
  } else {
    // Halftone shading: surfaces turned from the light print darker, so
    // their dots swell; near feathers are bigger in perspective.
    let light = mix(1.0, 1.28 - 0.4 * clamp(shade, 0.0, 1.0), pc);
    size = params.dotSize * (0.34 + 0.86 * weight) * mix(0.6, 1.0, pc) * mix(1.0, persp, pc) * light;
    tone = inked + select(0.0, 8.0, facing < 0.0 && pc > 0.5);
  }
  sprites[i] = vec4f(pos, size, tone);
}
