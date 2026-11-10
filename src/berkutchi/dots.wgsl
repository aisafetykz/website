// Draws each particle as a round halftone dot printed on paper: gold for the
// head and coverts, rust for the flight feathers, blue for drifting motes.

struct View {
  resolution: vec2f, // device pixels
}

@group(0) @binding(0) var<storage, read> sprites: array<vec4f>;
@group(0) @binding(1) var<uniform> view: View;

struct Out {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) tone: f32,
  @location(2) size: f32,
}

@vertex fn vs_main(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
  var quad = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let s = sprites[i];
  let corner = quad[v];
  let aspect = view.resolution.x / view.resolution.y;
  var out: Out;
  out.local = corner;
  out.tone = s.w;
  out.size = s.z;
  if (s.z <= 0.0) {
    out.position = vec4f(2.0, 2.0, 0.0, 1.0);
    return out;
  }
  // World units -> NDC; pad the quad by a pixel for antialiasing.
  let ndc = vec2f(s.x / aspect, s.y);
  let half = (s.z * 0.5 + 1.0) / view.resolution * 2.0;
  out.position = vec4f(ndc + corner * half, 0.0, 1.0);
  return out;
}

@fragment fn fs_main(in: Out) -> @location(0) vec4f {
  let radiusPx = in.size * 0.5;
  let distPx = length(in.local) * (radiusPx + 1.0);
  let cover = 1.0 - smoothstep(radiusPx - 0.75, radiusPx + 0.75, distPx);
  if (cover <= 0.0) {
    discard;
  }
  if (in.tone < 0.0) {
    return vec4f(0.29, 0.47, 0.75, cover * 0.7); // drifting mote
  }
  let gold = vec3f(0.96, 0.7, 0.12);
  let amber = vec3f(0.9, 0.5, 0.13);
  let rust = vec3f(0.72, 0.31, 0.1);
  let t = clamp(in.tone, 0.0, 1.0);
  var color = select(mix(amber, rust, (t - 0.5) * 2.0), mix(gold, amber, t * 2.0), t < 0.5);
  // A thin navy rim keeps neighbouring dots apart, like a second ink pass,
  // and lets the eagle read in front of the sun.
  let rim = smoothstep(radiusPx - 1.6, radiusPx - 0.6, distPx) * step(2.5, radiusPx);
  color = mix(color, vec3f(0.07, 0.13, 0.27), rim * 0.3);
  return vec4f(color, cover);
}
