// One thread per particle. Eagle particles spring toward their place in the
// flapping, banking silhouette; how strongly depends on `cohesion`, staggered
// per particle so the bird assembles and dissolves feather by feather. Loose
// particles ride a wind field across the steppe. Ambient motes (tone < 0)
// always drift.

struct Particle {
  home: vec2f, // position in the eagle's local frame
  tone: f32,   // 0..1 dot weight; negative for ambient motes
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
  bank: f32,
  flap: f32,
  flapAmp: f32,
  pointerOn: f32,
  dotSize: f32, // device pixels
  count: u32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read_write> state: array<vec4f>; // pos.xy, vel.xy
@group(0) @binding(3) var<storage, read_write> sprites: array<vec4f>; // pos.xy, size px, tone

fn wind(p: vec2f, t: f32, seed: f32) -> vec2f {
  let a = sin(p.x * 1.3 + t * 0.21 + seed * 2.0) + cos(p.y * 2.1 - t * 0.17) + 0.6 * sin((p.x + p.y) * 3.7 + seed * 6.0);
  return vec2f(0.11 + 0.05 * cos(a * 1.7), 0.06 * sin(a * 2.3));
}

// Wings fold and lift around the shoulder as the eagle flaps. Seen from
// below, a raised wing shortens and its tip moves up.
fn flapped(home: vec2f) -> vec2f {
  let ax = abs(home.x);
  let reach = max(ax - 0.07, 0.0);
  let a = params.flapAmp * sin(params.flap - ax * 1.4);
  let x = sign(home.x) * (min(ax, 0.07) + reach * cos(a));
  return vec2f(x, home.y + reach * sin(a) * 0.45);
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
  let dt = params.dt;
  let ambient = p.tone < 0.0;

  // Staggered: low seeds join first and leave last.
  var pc = 0.0;
  if (!ambient) {
    let start = p.seed * 0.55;
    pc = smoothstep(start, start + 0.45, params.cohesion);
    // After a click the hold loosens, so scattered feathers drift before
    // they are pulled home; low seeds return first.
    pc *= 1.0 - 0.92 * smoothstep(p.seed * 0.4, p.seed * 0.4 + 0.6, params.kick);
  }

  var acc = vec2f(0.0);
  if (pc > 0.0) {
    let local = flapped(p.home);
    let cb = cos(params.bank);
    let sb = sin(params.bank);
    let goal = params.center + params.scale * vec2f(local.x * cb - local.y * sb, local.x * sb + local.y * cb);
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
    size = params.dotSize * (0.15 + 0.95 * p.tone) * mix(0.6, 1.0, pc);
    tone = p.tone;
  }
  sprites[i] = vec4f(pos, size, tone);
}
