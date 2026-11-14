#version 300 es
// Sets the tower in numbers. Every cell of a text grid holds one character
// of a stream of weights ("0.4817-0.0923 0.3301") wherever the tower covers
// it; a cell the tower only grazes gets a point or a dash, which softens the
// outline. Nothing is drawn that is not a character.
//
// It is shaded like the round thing it is: toward the light the decimals
// thin out into 1s and 7s, in shadow they fill up with 8s and 0s. A small
// spot follows the pointer and stirs the weights under it, and clicking the
// tower sets off a signal from that point.
//
// And it runs like the network its weights belong to. Every few seconds it
// makes a forward pass: a prompt resolves out of the weights in the trunk,
// climbs the tower a layer at a time, each layer attending across a
// different stretch of its row, fans out through the branches, which are its
// heads, and the sphere says the next token. Then both turn back into
// numbers.
//
// The sky behind it is faint and also numbers: uneven beams of light from
// the sphere, and clouds drifting past.
//
// When it is really snowing in Astana, it snows here too.
//
// Now and then Samruk, the bird of the legend, flies in, circles the crown
// and flies on.
//
// The tower arrives the way the legend has it: the tree of life grows up
// from the ground, and then the golden egg appears in its crown.
precision highp float;

const int SIGNALS = 8;
const int PULSES = 6;
const int KEEP_OUTS = 12;
const int PROMPTS = 4;
const float WORD_CELLS = 20.0; // the longest prompt
const int LAYERS = 6;
// The page keeps the same time, to follow the pass on its own statement.
const float PASS = 9.5;     // seconds from one forward pass to the next
const float CLIMB_AT = 1.3; // into a pass, when the prompt starts up the trunk
const float STEP = 0.28;    // seconds to a layer

// The colours come from the page.
uniform vec3 uInk;      // the steel
uniform vec3 uBlue;     // a signal
uniform vec3 uGold;     // the sphere
uniform vec3 uGlow;     // the sphere, lit up
uniform vec3 uCloud;
uniform float uSnow;    // how hard it is snowing in Astana, 0 to 1
uniform float uPromptLengths[PROMPTS];
uniform float uNextLengths[PROMPTS];
uniform vec4 uBird;     // Samruk: x, y, half its wingspan (0: not here), wingbeat -1 to 1
uniform vec2 uBirdWay;  // which way it faces (-1 or 1), and whether it is in front of the tower
uniform vec2 uRes;      // canvas size, device px
uniform vec2 uCell;     // one character cell, device px
uniform vec4 uMapRect;  // where the coverage map sits: x, y, width, height
uniform vec2 uFade;     // the tower fades out between these two heights
uniform vec2 uPrompt;   // the row the prompt is set on, and how many rows each layer above it gets
uniform vec3 uSphere;   // the sphere's centre, and one tower unit, device px
uniform float uTime;
uniform float uGrow;    // seconds since the tower began to grow
uniform vec4 uKeepOuts[KEEP_OUTS]; // each line of text and each button: left, top, right, bottom
uniform vec3 uPointer;  // the spot that follows the pointer: x, y, and how present it is
uniform vec2 uTail;     // where the spot was a moment ago
uniform float uRadius;  // its reach
uniform vec3 uPulses[PULSES]; // recent clicks: x, y, seconds ago (negative: unused)
uniform vec3 uSignals[SIGNALS]; // where a click set one off: x, y, seconds ago (negative: unused)
uniform sampler2D uMap;
uniform sampler2D uAtlas; // "0123456789.-*" in one row
uniform sampler2D uWords; // each prompt and then its next token, one to a row

out vec4 outColor;

// The digits from heaviest to lightest, for shading.
const float RAMP[10] = float[10](8.0, 0.0, 6.0, 9.0, 5.0, 3.0, 2.0, 4.0, 7.0, 1.0);

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

// The tower as a signal sees it. Positions are in tower units from the
// sphere's centre. `alongAt` is how far a point is from the ground, going up
// the trunk and out along the branches. `acrossAt` says which branch it is
// on: a branch keeps about the same value from the trunk to its tip.
float alongAt(vec2 at) {
  return 1.83 - at.y + 0.6 * abs(at.x) * step(at.y, 1.83);
}
float acrossAt(vec2 at, float along) {
  float t = clamp(along / 2.4, 0.0, 1.0);
  return at.x / (0.36 + 0.12 * t + 0.52 * t * t);
}

// Soft noise, for the clouds.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Clouds, in two layers: big slow-billowing ones nearby and smaller,
// fainter, slower ones far off, all drifting to the right. Bending the
// noise with more noise is what gives them billows instead of streaks.
// `at` is in tower units from the sphere's centre.
float billow(vec2 p) {
  p += 0.4 * vec2(noise(p * 1.4 + 11.0), noise(p * 1.4 + 37.0));
  float n = noise(p) * 0.5 + noise(p * 2.03 + 7.3) * 0.27 + noise(p * 4.1 + 1.7) * 0.15 + noise(p * 8.3 + 3.1) * 0.08;
  return smoothstep(0.52, 0.76, n);
}
float clouds(vec2 at) {
  float near = billow(at * vec2(0.65, 1.5) + vec2(-uTime * 0.014, 0.0));
  float far = billow(at * vec2(1.3, 2.9) + vec2(-uTime * 0.006, 40.0));
  return max(near, far * 0.55);
}

// Sunlight from the sphere, the way it comes through gaps in cloud: beams of
// uneven width and strength, each reaching its own distance, slowly
// shifting. The noise is read around a circle so the beams have no seam.
float rays(vec2 at) {
  float r = length(at);
  vec2 dir = at / max(r, 0.001);
  float drift = uTime * 0.02;
  float beam = noise(dir * 3.3 + drift) * 0.6 + noise(dir * 8.5 - drift * 1.7 + 5.0) * 0.4;
  float far = 1.5 + 1.6 * noise(dir * 2.1 + 9.0);
  float reach = (r - 0.66) / (far - 0.66);
  return smoothstep(0.48, 0.7, beam) * step(0.0, reach) * pow(max(0.0, 1.0 - reach), 1.6);
}

// Distance from a point to a line segment.
float segment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return distance(p, a + ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
}

// Samruk, the bird of the legend, who lays the golden egg in the tree: a
// body, a head, a tail and two jointed wings that beat. Returns how much of
// a point the bird covers.
float bird(vec2 p) {
  if (uBird.z <= 0.0) return 0.0;
  vec2 l = (p - uBird.xy) / uBird.z;
  l.x *= uBirdWay.x; // drawn facing right
  float beat = uBird.w;
  vec2 elbow = vec2(0.42, -0.2 - 0.26 * beat);
  vec2 tip = vec2(1.0, 0.04 - 0.6 * beat);
  float d = segment(l, vec2(0.2, -0.08), vec2(-0.34, 0.12)); // head to tail
  for (float side = -1.0; side <= 1.0; side += 2.0) {
    // The far wing is a little shorter, so the bird reads as turned.
    vec2 reach = vec2(side * (side < 0.0 ? 0.8 : 1.0), 1.0);
    d = min(d, segment(l, vec2(0.0), elbow * reach));
    d = min(d, segment(l, elbow * reach, tip * reach));
  }
  return 1.0 - smoothstep(0.07, 0.13, d);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);

  // A small spot follows the pointer. Under it the grid swells a little,
  // like a lens, and the weights are stirred: `e` is how much. The spot is
  // not a fixed disc: its edge wobbles, and when it moves it draws out into
  // a tail that thins toward where it has been.
  vec2 head = p - uPointer.xy;
  vec2 q = p - head * uPointer.z * exp(-dot(head, head) / (uRadius * uRadius * 0.5)) * 0.25;

  vec2 cell = floor(q / uCell);
  vec2 inCell = fract(q / uCell);
  vec2 centre = (cell + 0.5) * uCell;
  vec2 fromHead = centre - uPointer.xy;
  vec2 tail = uTail - uPointer.xy;
  float back = clamp(dot(fromHead, tail) / max(dot(tail, tail), 1.0), 0.0, 1.0);
  float spotSize = uRadius * (0.65 + 0.7 * noise(cell * 0.3 + uTime * 0.9)) * mix(1.0, 0.4, back);
  float away = length(fromHead - tail * back) / spotSize;
  float e = uPointer.z * exp(-away * away);
  // A click sends a ring of the same stirring out across the page. The
  // ring is rough: its edge runs ahead in some places and lags in others,
  // and it is stronger in some cells than their neighbours.
  for (int i = 0; i < PULSES; i++) {
    float age = uPulses[i].z;
    if (age < 0.0) continue;
    float rough = noise(cell * 0.22 + float(i) * 13.7) - 0.5;
    float ring = (distance(centre, uPulses[i].xy) / uSphere.z - age * 2.1 + rough * 0.5) / 0.19;
    float grain = 0.35 + 1.1 * noise(cell * 0.9 + age * 4.0);
    e += exp(-ring * ring) * grain * max(0.0, 1.0 - age / 1.8);
  }
  e = min(e, 1.0);
  float fade = 1.0 - smoothstep(uFade.x, uFade.y, centre.y);

  float seed = hash(cell);

  // Growing: a ragged front climbs from the ground to the highest tip, and
  // the steel exists only below it. Then the sphere swells from its centre.
  // `fresh` is 1 where a cell has only just appeared.
  float band = uSphere.z * 0.4;
  float rise = 1.0 - pow(1.0 - clamp(uGrow / 2.0, 0.0, 1.0), 2.5);
  float front = mix(min(uRes.y, uFade.y) + band, uMapRect.y - 2.0 * band, rise);
  float steelAge = (centre.y - front) / band - seed;
  float swell = 1.0 - pow(1.0 - clamp((uGrow - 1.6) / 1.1, 0.0, 1.0), 2.5);
  float sphereAge = (swell * 1.5 - distance(centre, uSphere.xy) / (0.6 * uSphere.z)) / 0.4 - seed * 0.5;
  float fresh = 1.0 - smoothstep(0.0, 1.0, max(steelAge, 0.0));

  // How much of this cell the tower covers.
  vec2 uv = (centre - uMapRect.xy) / uMapRect.zw;
  vec2 cover = texture(uMap, uv).rg * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y);
  float isSteel = step(0.14, cover.r) * step(0.0, steelAge);
  float isSphere = step(0.14, cover.g) * step(0.0, sphereAge) * (1.0 - isSteel);
  // Samruk passes in front of the tower or behind it.
  float isBird = step(0.5, bird(centre)) * max(uBirdWay.y, (1.0 - isSteel) * (1.0 - isSphere));
  isSteel *= 1.0 - isBird;
  isSphere *= 1.0 - isBird;
  float covered = isSteel * cover.r + isSphere * cover.g + isBird;

  // The sky, which comes up once the tower stands.
  vec2 at = (centre - uSphere.xy) / uSphere.z; // tower units, from the sphere's centre
  // The sky and the pointer's stirring thin out toward the page's text and
  // buttons. The fade is long and starts just inside them, so nothing ever
  // quite sits under a letter and there is no visible edge.
  float clear = 1.0;
  for (int i = 0; i < KEEP_OUTS; i++) {
    vec2 outside = max(uKeepOuts[i].xy - centre, centre - uKeepOuts[i].zw) / uSphere.z;
    float gap = length(max(outside, 0.0)) + min(max(outside.x, outside.y), 0.0);
    clear = min(clear, smoothstep(0.0, 0.12, gap));
  }
  float open = clear * smoothstep(2.6, 4.4, uGrow);
  float cloud = clouds(at) * open;
  // A cloud in the way dims the light behind it.
  float ray = rays(at) * open * (1.0 - 0.7 * cloud);
  float sky = max(cloud, ray);
  float isSky = (1.0 - isSteel) * (1.0 - isSphere) * (1.0 - isBird);
  covered += isSky * max(sky * 0.6, e * clear);

  // Snow: stars and points falling a cell at a time, each column at its own
  // pace, swaying a little. The harder it snows, the more of them.
  float snow = 0.0;
  float flakeKind = 0.0;
  if (uSnow > 0.0) {
    float pace = 1.6 * (0.7 + 0.6 * hash(vec2(cell.x, 3.0)));
    float sway = floor(1.6 * sin(uTime * 0.35 + cell.y * 0.12 + hash(vec2(cell.x, 9.0)) * 6.28318));
    vec2 flake = vec2(cell.x + sway, cell.y - floor(uTime * pace + hash(vec2(cell.x, 5.0)) * 50.0));
    snow = step(0.988 - 0.03 * uSnow, hash(flake)) * open * isSky;
    flakeKind = hash(flake + 2.0);
  }

  // A forward pass: which prompt, and how far into the pass it is.
  float run = (uGrow - 4.2) / PASS;
  float into = fract(run) * PASS;
  float pass = floor(run);
  float live = step(0.0, run) * step(uGrow, 500.0);
  float which = mod(pass, float(PROMPTS));
  float wordRows = float(PROMPTS * 2);
  // The prompt sits in the trunk, a cell to a character. Its letters resolve
  // left to right, hold until the sphere has answered, and turn back.
  float letters = uPromptLengths[int(which)];
  float promptRow = uPrompt.x;
  float promptCell = cell.x - floor(uSphere.x / uCell.x) + floor(letters / 2.0);
  float inPrompt = live * float(cell.y == promptRow) * step(-1.0, promptCell) * step(promptCell, letters) * step(0.5, clear);
  // The layers stand between the prompt and the sphere. Where the tower
  // fades out before there is room for them, the pass skips them.
  float perLayer = uPrompt.y;
  float hasLayers = step(1.0, perLayer);
  float fanAt = CLIMB_AT + float(LAYERS) * STEP * hasLayers; // when it leaves the layers for the branches
  float saidAt = fanAt + mix(1.0, 0.7, hasLayers);           // when it reaches the sphere
  float until = saidAt + 3.6;
  float shows = promptCell / letters * 0.7 + 0.3 * hash(vec2(cell.x, pass));
  float letter = inPrompt * step(shows, into) * step(into, until + 0.5 * shows);
  vec2 turns = (into - vec2(shows, until + 0.5 * shows)) / 0.25;
  float turning = inPrompt * max(exp(-turns.x * turns.x), exp(-turns.y * turns.y));
  // The next token resolves across the middle of the sphere.
  float nextLetters = uNextLengths[int(which)];
  float nextCell = cell.x - floor(uSphere.x / uCell.x) + floor(nextLetters / 2.0);
  float inNext = live * float(cell.y == floor(uSphere.y / uCell.y)) * isSphere * step(-1.0, nextCell) * step(nextCell, nextLetters);
  float nextShows = saidAt + 0.25 + 0.3 * nextCell / nextLetters + 0.2 * hash(vec2(cell.x, pass + 0.5));
  float nextLetter = inNext * step(nextShows, into) * step(into, until + 0.5 * shows);
  vec2 nextTurns = (into - vec2(nextShows, until + 0.5 * shows)) / 0.25;
  float nextTurning = inNext * max(exp(-nextTurns.x * nextTurns.x), exp(-nextTurns.y * nextTurns.y));
  fresh = mix(fresh, 1.0 - smoothstep(0.0, 1.0, sphereAge), isSphere);

  // Light: the sphere is a ball and the trunk a column, lit from the upper
  // left, or from the pointer while it is over the page.
  vec2 toPointer = uPointer.xy - centre;
  vec2 lightFrom = mix(vec2(-0.5, -0.6), 0.75 * toPointer / (length(toPointer) + 1.0), uPointer.z);
  vec3 light = normalize(vec3(lightFrom, 0.62));
  vec2 ball = at / 0.58;
  float across = clamp(at.x / 0.4, -1.0, 1.0);
  vec3 normal = isSphere > 0.5
    ? vec3(ball, sqrt(max(0.0, 1.0 - dot(ball, ball))))
    : vec3(across, 0.0, sqrt(1.0 - across * across));
  // Only the solid trunk is round; branches and rings are lit evenly.
  float lit = mix(0.5, clamp(dot(normal, light), 0.0, 1.0), max(isSphere, step(0.97, cover.r)));

  // The pass climbs the tower a layer at a time. When a layer wakes, a band
  // of rows lights across the whole tower at its height, and along the
  // band's first row a stretch turns gold: the layer attending, each one
  // across a different stretch. `along` is how far up the tower a cell is,
  // from where the branches leave the trunk, and `strand` how far across.
  float along = alongAt(at);
  float strand = acrossAt(at, along);
  float up = promptRow - 2.0 - cell.y; // rows above the first layer's first row
  float layer = floor(up / max(perLayer, 1.0));
  float rowIn = floor(up - layer * perLayer);
  float inLayers = hasLayers * step(0.0, up) * step(layer, float(LAYERS) - 0.5);
  float since = (into - CLIMB_AT) / STEP - layer; // in layers
  float wake = live * inLayers * isSteel * smoothstep(0.0, 0.25, since) * exp(-1.6 * max(since - 1.0, 0.0));
  float attendAt = 1.2 * (hash(vec2(layer + 3.0, pass)) - 0.5);
  float attendOver = 0.35 + 0.45 * hash(vec2(pass, layer + 9.0));
  float attending = wake * float(rowIn == 0.0) * step(abs(strand - attendAt), attendOver);
  float signal = wake * mix(0.7, 1.0, float(rowIn == 0.0)) * step(rowIn, max(1.0, min(floor(perLayer) - 1.0, 3.0)) - 0.5);

  // Out of the last layer it runs on and fans out along the branches. Each
  // branch is a head, and fires at its own strength on every pass.
  float branch = sign(strand) * (1.0 + step(0.38, abs(strand)) + step(0.7, abs(strand)) + step(0.9, abs(strand)));
  float firing = mix(1.0, 0.1 + 0.9 * smoothstep(0.15, 0.75, hash(vec2(branch + 5.0, pass))), smoothstep(0.35, 0.8, along));
  float gap = (along - mix(0.1, 1.0, hasLayers) - (into - fanAt) * 2.3) / 0.15;
  signal += live * exp(-gap * gap) * firing * isSteel * (1.0 - inLayers) * step(cell.y, promptRow - 2.0);
  // Then it lights the sphere, from the middle out.
  float arrival = (into - saidAt - 0.35 * length(ball)) / 0.4;
  signal += live * exp(-arrival * arrival) * isSphere;

  // Signals a click set off run on from where it touched the tower.
  // From the trunk one fans out into every branch; from a branch it stays
  // on that branch; on the sphere it spreads as a ring.
  float sent = 0.0;
  for (int i = 0; i < SIGNALS; i++) {
    float age = uSignals[i].z;
    if (age < 0.0) continue;
    vec2 from = (uSignals[i].xy - uSphere.xy) / uSphere.z;
    float start = alongAt(from);
    float spread = mix(3.0, 0.3, smoothstep(-0.1, 0.4, start));
    float off = (acrossAt(at, along) - acrossAt(from, start)) / spread;
    float ahead = (along - start - age * 2.3) / 0.18;
    float ring = (distance(at, from) - age * 1.4) / 0.1;
    float here = isSteel * exp(-ahead * ahead - off * off) + isSphere * exp(-ring * ring);
    sent = max(sent, here * max(0.0, 1.0 - age / 1.6));
  }
  signal = max(signal, sent);

  // Which character: sign, units, point, four decimals, and again. Each row
  // starts somewhere else, so the points do not line up into columns.
  float role = mod(cell.x + floor(hash(vec2(cell.y, 7.0)) * 7.0), 7.0);
  // Weights settle slowly on their own and churn when stirred or new.
  float tick = floor(uTime * 0.11 + seed * 40.0);
  if (max(max(max(fresh, signal), e), max(turning, nextTurning)) > 0.12 + 0.5 * seed) tick += floor(uTime * 13.0 + seed * 9.0);
  float r = hash(cell + tick * vec2(17.13, 5.71));
  // The decimals lean heavy or light with the shading, and still vary.
  float glyph = RAMP[int(clamp(lit + (r - 0.5) * 0.7, 0.0, 0.999) * 10.0)];
  float blank = 0.0;
  if (role < 0.5) {
    // A positive weight leaves its sign empty, but only deep inside the
    // tower: a gap would break a thin branch.
    glyph = r < 0.45 ? 11.0 : floor(r * 18.0);
    // Past the minus sign there is no such character: those stay empty.
    blank = max(step(0.45, r) * step(0.97, covered), step(11.5, glyph));
  } else if (role < 1.5) {
    glyph = step(0.86, r);
  } else if (role < 2.5) {
    glyph = 10.0;
  }
  // A grazed cell gets something light.
  if (covered < 0.3) {
    glyph = seed < 0.6 ? 10.0 : 11.0;
    blank = 0.0;
  }
  if (snow > 0.0) {
    blank = 0.0;
    glyph = flakeKind < 0.6 ? 12.0 : 10.0;
  }
  float number = texture(uAtlas, vec2((glyph + inCell.x) / 13.0, inCell.y)).r * (1.0 - blank);
  // A letter takes its cell over, and the cell either side of a word is
  // left empty.
  if (letter > 0.0) number = texture(uWords, vec2((promptCell + inCell.x) / WORD_CELLS, (which * 2.0 + inCell.y) / wordRows)).r * step(0.0, promptCell) * step(promptCell, letters - 1.0);
  if (nextLetter > 0.0) number = texture(uWords, vec2((nextCell + inCell.x) / WORD_CELLS, (which * 2.0 + 1.0 + inCell.y) / wordRows)).r * step(0.0, nextCell) * step(nextCell, nextLetters - 1.0);

  vec3 steelColor = mix(uInk, uBlue, max(signal, smoothstep(0.0, 0.5, e)));
  // The middle of the spot, and the head of a signal a click sent, are gold.
  steelColor = mix(steelColor, uGlow, smoothstep(0.6, 1.0, max(sent, e)));
  // New growth comes in bright and cools to ink.
  steelColor = mix(steelColor, mix(uBlue, uGlow, smoothstep(0.5, 1.0, fresh)), fresh);
  // The row a layer attends along is gold.
  steelColor = mix(steelColor, uGlow, attending);
  // The weights flash gold as the prompt's letters turn.
  steelColor = mix(steelColor, uGlow, turning * 0.8);

  // The sky first (under the spot it shows that it is weights too), then
  // the sphere in gold, then the steel in ink.
  vec3 color = mix(mix(uCloud, uGlow, step(cloud, ray)), uBlue, e);
  float alpha = max(max(cloud * 0.5, ray * 0.55), e * 0.45 * clear);
  // White would vanish on pale paper, so the snow is a soft blue.
  color = mix(color, mix(uCloud, uBlue, 0.35), step(alpha, snow));
  alpha = max(alpha, snow);
  color = mix(color, mix(uGold, uGlow, max(max(fresh, signal), max(e, nextTurning))), isSphere);
  alpha = mix(alpha, 1.0 - 0.4 * lit, isSphere);
  color = mix(color, steelColor, isSteel);
  alpha = mix(alpha, 1.0 - 0.3 * lit * step(0.97, cover.r), isSteel);

  color = mix(color, uGold, isBird);
  alpha = mix(alpha, clear * mix(0.7, 1.0, uBirdWay.y), isBird);

  // The prompt reads in blue wherever it falls, on the steel or on open
  // sky, and the sphere's answer in ink.
  color = mix(color, mix(uInk, uBlue, 0.8), letter);
  color = mix(color, uInk, nextLetter);
  alpha = mix(alpha, 1.0, max(letter, nextLetter));

  alpha *= number * fade;
  outColor = vec4(color * alpha, alpha);
}
