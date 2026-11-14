// Draws each particle as a round halftone dot printed on paper. The eagle's
// tone carries its ink too (tone + 2 * ink): plumage runs from wheat and gold
// on the nape to deep brown on the coverts and wingtips, with yellow for the
// cere, and near-black for the beak and eye. Drifting motes are blue.

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

// The eagle's plumage, light to dark: pale wheat, gold, amber, rust, deep brown.
fn plumage(t: f32) -> vec3f {
  let wheat = vec3f(0.99, 0.85, 0.52);
  let gold = vec3f(0.97, 0.7, 0.1);
  let amber = vec3f(0.92, 0.5, 0.11);
  let rust = vec3f(0.74, 0.3, 0.09);
  let brown = vec3f(0.4, 0.15, 0.07);
  if (t < 0.3) { return mix(wheat, gold, t / 0.3); }
  if (t < 0.5) { return mix(gold, amber, (t - 0.3) / 0.2); }
  if (t < 0.72) { return mix(amber, rust, (t - 0.5) / 0.22); }
  return mix(rust, brown, (t - 0.72) / 0.28);
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
  // tone + 2 * ink, plus 8 where we see the top of a wing (darker, browner).
  let above = in.tone >= 8.0;
  let packed = in.tone - select(0.0, 8.0, above);
  let ink = floor(packed * 0.5);
  let t = clamp(packed - 2.0 * ink, 0.0, 1.0);
  var color = plumage(select(t, mix(t, 0.95, 0.6), above));
  var rimInk = 0.16;
  if (ink == 1.0) {
    color = vec3f(1.0, 0.78, 0.1); // the cere
  } else if (ink == 2.0) {
    color = vec3f(0.09, 0.12, 0.22); // beak, talons, eye
    rimInk = 0.0;
  }
  // A thin navy rim keeps neighbouring dots apart, like a second ink pass,
  // and lets the eagle read in front of the sun.
  let rim = smoothstep(radiusPx - 1.6, radiusPx - 0.6, distPx) * step(2.5, radiusPx);
  color = mix(color, vec3f(0.07, 0.13, 0.27), rim * rimInk);
  return vec4f(color, cover);
}
