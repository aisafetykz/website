// Browser entry for the hero art: the Baiterek tower written out in weights.
// It is decoration, so on any failure (no WebGL2, a lost context) the hero
// simply stays plain.

import fragment from "./weights.frag?raw";
import type { Predicting } from "./next";
import { drawBaiterek, HALF_WIDTH, HEADROOM, SPHERE, TIPS, TRUNK } from "./shape";

const GLYPHS = "0123456789.-*"; // the star is for snow
const SIGNALS = 8; // matches the shader
const PULSES = 6; // too
const KEEP_OUTS = 12; // too
// What the tower is asked, and what it answers: on each forward pass one
// prompt resolves in the trunk and the sphere says the token that comes
// next. The shader knows how many there are and how long the longest prompt
// is. The first is the page's own statement, whose last word waits for it.
const PROMPTS: [prompt: string, next: string][] = [
  ["making sure AI goes", "well"],
  ["AI safety", "kazakhstan"],
  ["бәй", "терек"],
  ["the tree of", "life"],
];
const WORD_CELLS = 20;
// A pass's timing, as the shader has it, in seconds: from planting to the
// first pass, from one pass to the next, into a pass until it starts up the
// layers, and to a layer.
const FIRST_PASS = 4.2;
const PASS = 9.5;
const CLIMB_AT = 1.3;
const STEP = 0.28;
const LAYERS = 6;
// The weather in Astana right now, from Open-Meteo (free, no key). The codes
// are WMO's: these are the ones that mean snow, with how hard.
const WEATHER =
  "https://api.open-meteo.com/v1/forecast?latitude=51.17&longitude=71.43&current=weather_code,snowfall";
const SNOW: Record<number, number> = { 71: 0.35, 77: 0.35, 85: 0.5, 73: 0.7, 75: 1, 86: 1 };
const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the screen.
  gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0);
}`;

function program(gl: WebGL2RenderingContext) {
  const prog = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    gl.attachShader(prog, shader);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "program");
  return prog;
}

export async function mount(root: HTMLElement) {
  const canvas = root.querySelector("canvas");
  const gl = canvas?.getContext("webgl2", { antialias: false });
  if (!canvas || !gl) return;

  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // The page hears how far the pass on its statement has got: -1 before it,
  // 0 once the prompt is in, then each layer, and one past the last layer
  // when the sphere has said the next token.
  let told = -1;
  const tell = (layer: number) => {
    const detail: Predicting = { layer: (told = layer), layers: LAYERS };
    if (!still) root.dispatchEvent(new CustomEvent("baiterek:predict", { detail }));
  };
  tell(-1);
  await document.fonts.load('500 16px "IBM Plex Mono"', GLYPHS + PROMPTS.flat().join("")).catch(() => {});

  let prog: WebGLProgram;
  try {
    prog = program(gl);
  } catch (err) {
    console.info("Baiterek: leaving the hero plain.", err);
    tell(LAYERS + 1);
    return;
  }
  gl.useProgram(prog);
  const uniform = (name: string) => gl.getUniformLocation(prog, name);

  const texture = (unit: number, name: string) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniform(name), unit);
    return (source: HTMLCanvasElement) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    };
  };
  const uploadMap = texture(0, "uMap");
  const uploadAtlas = texture(1, "uAtlas");
  const uploadWords = texture(2, "uWords");
  const words = document.createElement("canvas");
  const map = document.createElement("canvas");
  const mapContext = map.getContext("2d", { willReadFrequently: true })!;
  const atlas = document.createElement("canvas");

  let dpr = 1;
  let hasLayers = true;
  const sphere = { x: 0, y: 0, unit: 1 }; // device px
  // The lines of text and the buttons: left, top, right, bottom, in CSS px from the hero's corner.
  let textBoxes: number[][] = [];
  // Turns a spot on the canvas into a pixel of the map.
  let toMap = (_x: number, _y: number): [number, number] => [0, 0];

  // Size everything to the hero: where the tower stands, how big a character
  // is, and the density map and glyphs to match.
  const layout = () => {
    const box = root.getBoundingClientRect();
    if (!box.width || !box.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // The text blocks' ink, relative to the hero. The tower keeps clear of it.
    // Measured from the text itself; the blocks' own boxes are wider.
    const range = document.createRange();
    const text = (selector: string) => {
      const block = root.querySelector(selector)!;
      const ink = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        // Only what is always there, not what a forward pass shows for a while.
        if (walker.currentNode.parentElement?.closest("[aria-hidden]")) continue;
        range.selectNodeContents(walker.currentNode);
        for (const r of range.getClientRects()) {
          ink.left = Math.min(ink.left, r.left - box.left);
          ink.right = Math.max(ink.right, r.right - box.left);
          ink.top = Math.min(ink.top, r.top - box.top);
          ink.bottom = Math.max(ink.bottom, r.bottom - box.top);
        }
      }
      return ink;
    };
    const title = text("[data-title]");

    let centre: number;
    let top: number;
    let size: number; // CSS px per tower unit
    let fade = [1e9, 1e9 + 1];
    if (box.width / box.height <= 1.1) {
      // Portrait: the crown fills the top and the trunk fades out above the text.
      centre = box.width / 2;
      top = 64;
      size = Math.min(box.width * 0.42, 230);
      fade = [title.top - 100, title.top - 20];
    } else {
      // Landscape: the trunk comes down between the two bottom text blocks.
      const left = text("[data-statement]").right + 24;
      const right = text("[data-aside]").left - 24;
      size = Math.max(80, Math.min(box.height * 0.3, (right - left) / 2 / TRUNK));
      centre = Math.max(left + TRUNK * size, Math.min(left + (right - left) * 0.56, right - TRUNK * size));
      top = box.height * 0.05;
      // Any branch tip that would land on the title pushes the tower down.
      for (const [x, y] of TIPS) {
        if (centre + x * size < title.right + 16) top = Math.max(top, title.bottom + 14 - y * size);
      }
    }

    const cellW = Math.round(Math.max(5, Math.min(7, Math.round(size / 42))) * dpr);
    const cellH = Math.round(cellW * 1.7);
    const px = size * dpr;
    gl.uniform1f(uniform("uRadius"), px * 0.16);

    // The map covers whole cells, two map pixels to a cell each way, so one
    // filtered sample at a cell's centre averages the cell.
    const x0 = Math.round((centre * dpr - HALF_WIDTH * px) / cellW) * cellW;
    const y0 = Math.round((top * dpr - HEADROOM * px) / cellH) * cellH;
    const cols = Math.ceil((2 * HALF_WIDTH * px) / cellW);
    const rows = Math.ceil((canvas.height - y0) / cellH) + 2;
    map.width = cols * 2;
    map.height = rows * 2;
    drawBaiterek(mapContext, (2 * px) / cellW, (2 * px) / cellH, (rows * cellH) / px, (1.7 * cellW) / px);
    uploadMap(map);
    toMap = (x, y) => [((x - x0) / cellW) * 2, ((y - y0) / cellH) * 2];

    atlas.width = GLYPHS.length * cellW;
    atlas.height = cellH;
    const ctx = atlas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, atlas.width, atlas.height);
    const fontSize = cellW / 0.62;
    ctx.font = `500 ${fontSize}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    [...GLYPHS].forEach((glyph, i) => ctx.fillText(glyph, (i + 0.5) * cellW, cellH / 2 + fontSize * 0.35));
    uploadAtlas(atlas);

    // The prompts and their next tokens, set in the same cells: each prompt
    // on a row and its next token on the row below.
    words.width = WORD_CELLS * cellW;
    words.height = PROMPTS.length * 2 * cellH;
    const pen = words.getContext("2d")!;
    pen.fillStyle = "#000";
    pen.fillRect(0, 0, words.width, words.height);
    pen.font = ctx.font;
    pen.fillStyle = "#fff";
    pen.textAlign = "center";
    PROMPTS.flat().forEach((text, row) => {
      [...text].forEach((glyph, i) => pen.fillText(glyph, (i + 0.5) * cellW, (row + 0.5) * cellH + fontSize * 0.35));
    });
    uploadWords(words);
    gl.uniform1fv(uniform("uPromptLengths"), PROMPTS.map(([prompt]) => [...prompt].length));
    gl.uniform1fv(uniform("uNextLengths"), PROMPTS.map(([, next]) => [...next].length));

    gl.uniform2f(uniform("uRes"), canvas.width, canvas.height);
    gl.uniform2f(uniform("uCell"), cellW, cellH);
    gl.uniform4f(uniform("uMapRect"), x0, y0, cols * cellW, rows * cellH);
    gl.uniform2f(uniform("uFade"), fade[0] * dpr, fade[1] * dpr);
    // What the sky keeps clear of: every line of text, and every link (the
    // buttons) as a whole.
    const keepOuts: number[][] = [];
    const content = root.querySelector("[data-content]")!;
    for (const block of content.children) {
      // One box per line of a block: the pieces of a line share a top.
      const lines = new Map<number, number[]>();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        // Not the candidates for the next token, which bring their own ground.
        if (walker.currentNode.parentElement?.closest("a, [aria-hidden]")) continue;
        range.selectNodeContents(walker.currentNode);
        for (const r of range.getClientRects()) {
          if (r.width < 1) continue;
          const line = lines.get(Math.round(r.top)) ?? [Infinity, r.top, -Infinity, r.bottom];
          lines.set(Math.round(r.top), [Math.min(line[0], r.left), line[1], Math.max(line[2], r.right), line[3]]);
        }
      }
      // A line's box is taller than its letters; trim it toward the ink.
      for (const [left, top, right, bottom] of lines.values()) {
        const trim = (bottom - top) * 0.14;
        keepOuts.push([left, top + trim, right, bottom - trim]);
      }
    }
    for (const link of content.querySelectorAll("a")) {
      const r = link.getBoundingClientRect();
      keepOuts.push([r.left, r.top, r.right, r.bottom]);
    }
    textBoxes = keepOuts
      .slice(0, KEEP_OUTS)
      .map(([left, top, right, bottom]) => [left - box.left, top - box.top, right - box.left, bottom - box.top]);
    const keepOutData = new Float32Array(KEEP_OUTS * 4).fill(-1e6);
    textBoxes.forEach((edges, i) => keepOutData.set(edges.map((edge) => edge * dpr), i * 4));
    gl.uniform4fv(uniform("uKeepOuts"), keepOutData);
    Object.assign(sphere, { x: x0 + (HALF_WIDTH + SPHERE.x) * px, y: y0 + (HEADROOM + SPHERE.y) * px, unit: px });
    gl.uniform3f(uniform("uSphere"), sphere.x, sphere.y, sphere.unit);
    // The prompt's row, just below where the branches leave the trunk: never
    // below the bottom of the hero, or into where the tower fades. The
    // layers share out the rows from there up to the sphere.
    const promptRow = Math.floor(
      Math.min(sphere.y + 1.8 * px, Math.min(canvas.height, fade[0] * dpr) - 3 * cellH) / cellH,
    );
    const perLayer = (promptRow - 2 - Math.floor((sphere.y + 0.72 * px) / cellH)) / LAYERS;
    hasLayers = perLayer >= 1;
    gl.uniform2f(uniform("uPrompt"), promptRow, perLayer);
    if (!running) draw(performance.now());
  };

  // The colours come from the page.
  const style = getComputedStyle(document.documentElement);
  const colour = (name: string) => {
    const hex = style.getPropertyValue(name).trim().slice(1);
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  };
  const [paper, blue] = [colour("--paper"), colour("--blue")];
  gl.uniform3fv(uniform("uInk"), colour("--ink"));
  gl.uniform3fv(uniform("uBlue"), blue);
  gl.uniform3fv(uniform("uGold"), [0.851, 0.58, 0.047]); // deeper than the page's yellow, to hold on pale paper
  gl.uniform3fv(uniform("uGlow"), colour("--yellow"));
  gl.uniform3fv(
    uniform("uCloud"),
    paper.map((channel, i) => channel + (blue[i] - channel) * 0.42),
  );

  // It snows here when it is snowing in Astana. Add ?snow=1 to the address
  // to see it anyway (any strength from 0 to 1).
  if (!still) {
    const forced = new URLSearchParams(location.search).get("snow");
    const snowing =
      forced !== null
        ? Promise.resolve(Number(forced) || 0)
        : fetch(WEATHER)
            .then((response) => response.json())
            .then(({ current }) => SNOW[current.weather_code] ?? (current.snowfall > 0 ? 0.5 : 0));
    snowing.then((strength) => gl.uniform1f(uniform("uSnow"), Math.max(0, Math.min(1, strength)))).catch(() => {});
  }

  // Samruk's flight, in tower units from the sphere's centre: in from the
  // right, once around the crown (behind it, then in front), and away.
  const FLIGHT = 16; // seconds
  const samruk = (t: number): { x: number; y: number; behind: number } => {
    if (t < 4) {
      const s = 1 - (1 - t / 4) ** 2;
      return { x: 4.8 - 3.5 * s, y: -0.1 - 0.25 * s + 0.06 * Math.sin(t * 2.2), behind: 0 };
    }
    if (t < 12) {
      const turn = ((t - 4) / 8) * Math.PI * 2;
      return { x: 1.3 * Math.cos(turn), y: -0.35 - 0.34 * Math.sin(turn), behind: Math.max(0, Math.sin(turn)) };
    }
    const s = ((t - 12) / 4) ** 2;
    return { x: 1.3 + 3.6 * s, y: -0.35 - 1.2 * s + 0.06 * Math.sin(t * 2.2), behind: 0 };
  };
  let nextFlight = Infinity;

  // The pointer, the spot that trails a little behind it, and the signals
  // clicks have set off in the tower.
  const pointer = { x: 0, y: 0, over: false };
  const spot = { x: 0, y: 0, presence: 0 };
  const tail = { x: 0, y: 0 }; // follows more slowly still
  let pulses: { x: number; y: number; born: number }[] = [];
  const pulseData = new Float32Array(PULSES * 3);
  let signals: { x: number; y: number; born: number }[] = [];
  const signalData = new Float32Array(SIGNALS * 3);

  let last = performance.now();
  const draw = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    spot.presence += ((pointer.over ? 1 : 0) - spot.presence) * (1 - Math.exp(-dt * 7));
    spot.x += (pointer.x - spot.x) * (1 - Math.exp(-dt * 16));
    spot.y += (pointer.y - spot.y) * (1 - Math.exp(-dt * 16));
    tail.x += (spot.x - tail.x) * (1 - Math.exp(-dt * 5));
    tail.y += (spot.y - tail.y) * (1 - Math.exp(-dt * 5));
    gl.uniform2f(uniform("uTail"), tail.x, tail.y);
    pulses = pulses.filter((pulse) => now - pulse.born < 1800);
    pulseData.fill(-1);
    pulses.forEach((pulse, i) => pulseData.set([pulse.x, pulse.y, (now - pulse.born) / 1000], i * 3));
    gl.uniform3fv(uniform("uPulses"), pulseData);

    signals = signals.filter((signal) => now - signal.born < 1600);
    signalData.fill(-1);
    signals.forEach((signal, i) => signalData.set([signal.x, signal.y, (now - signal.born) / 1000], i * 3));
    gl.uniform3fv(uniform("uSignals"), signalData);
    gl.uniform3f(uniform("uPointer"), spot.x, spot.y, spot.presence);
    // Samruk, if it is passing.
    const flying = (now - nextFlight) / 1000;
    if (flying > FLIGHT) nextFlight = now + 45000 + Math.random() * 40000;
    if (flying > 0 && flying < FLIGHT) {
      const here = samruk(flying);
      const facing = Math.sign(samruk(flying + 0.05).x - here.x) || 1;
      gl.uniform4f(
        uniform("uBird"),
        sphere.x + here.x * sphere.unit,
        sphere.y + here.y * sphere.unit,
        sphere.unit * 0.24 * (1 - 0.2 * here.behind),
        Math.sin(flying * Math.PI * 2 * 1.4),
      );
      gl.uniform2f(uniform("uBirdWay"), facing, here.behind > 0 ? 0 : 1);
    } else {
      gl.uniform4f(uniform("uBird"), 0, 0, 0, 0);
    }
    // The pass on the page's statement, for the page to follow.
    const run = ((now - planted) / 1000 - FIRST_PASS) / PASS;
    let layer = -1;
    if (run >= 0) {
      const into = (run % 1) * PASS;
      const said = CLIMB_AT + (hasLayers ? LAYERS * STEP + 0.7 : 1) + 0.5;
      const own = Math.floor(run) % PROMPTS.length === 0;
      layer = own && into < said ? Math.max(0, Math.min(LAYERS, Math.floor((into - CLIMB_AT) / STEP) + 1)) : LAYERS + 1;
    }
    if (layer !== told) tell(layer);
    gl.uniform1f(uniform("uTime"), still ? 0 : now / 1000);
    // With reduced motion the tower is simply there, fully grown.
    gl.uniform1f(uniform("uGrow"), still ? 1e3 : Math.max(0, now - planted) / 1000);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  let running = false;
  let planted = Infinity;
  let frame = 0;
  const tick = (now: number) => {
    draw(now);
    frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (running || still) return;
    running = true;
    // It starts growing the first time it is seen.
    if (planted === Infinity) {
      planted = performance.now() + 200;
      // Samruk first comes by once the tower stands.
      nextFlight = planted + 7000;
    }
    last = performance.now();
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };

  layout();
  new ResizeObserver(layout).observe(root);
  document.fonts.ready.then(layout);
  if (still) return;

  // Only animate while on screen.
  let visible = false;
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) start();
    else stop();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (visible) start();
  });

  // A spot follows the pointer and carries the light. A click or tap sends
  // a ring out across the page and, on the tower, sets off a signal.
  const place = (e: PointerEvent): [number, number] => {
    const box = canvas.getBoundingClientRect();
    return [(e.clientX - box.left) * dpr, (e.clientY - box.top) * dpr];
  };
  const onTower = (x: number, y: number) => {
    const [red, green] = mapContext.getImageData(...toMap(x, y), 1, 1).data;
    return red > 36 || green > 36;
  };
  const send = (x: number, y: number) => {
    signals.unshift({ x, y, born: performance.now() });
    signals.length = Math.min(signals.length, SIGNALS);
  };
  root.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const [x, y] = place(e);
    // Coming in from outside, the spot starts where the pointer is.
    if (!pointer.over) {
      Object.assign(spot, { x, y });
      Object.assign(tail, { x, y });
    }
    Object.assign(pointer, { x, y, over: true });
  });
  root.addEventListener("pointerleave", () => (pointer.over = false));
  // Clicking the art twice quickly should not select the nearest text. A
  // double click on the text itself still does.
  root.addEventListener("mousedown", (e) => {
    if (e.detail < 2) return;
    const box = canvas.getBoundingClientRect();
    const [x, y] = [e.clientX - box.left, e.clientY - box.top];
    const onText = textBoxes.some(([left, top, right, bottom]) => x >= left && x <= right && y >= top && y <= bottom);
    if (!onText) e.preventDefault();
  });
  root.addEventListener("pointerdown", (e) => {
    const [x, y] = place(e);
    pulses.unshift({ x, y, born: performance.now() });
    pulses.length = Math.min(pulses.length, PULSES);
    if (onTower(x, y)) send(x, y);
  });
}
