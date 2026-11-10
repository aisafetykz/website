// Renders the Berkutchi scene headless (vgpu/node, Dawn) and writes PNGs.
//
//   bun run poster                                          # stills -> public/berkutchi*.png
//   bun scripts/render-berkutchi.ts --at 1,3,12,30 --out /tmp/frames
//
// With --at, the scene starts scattered, the eagle is called back at t=0.5s,
// and a frame is saved at each listed second. Use it to check the animation
// without a browser.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { prepareShader } from "@vgpu/wgsl/prepare";
import * as vg from "vgpu/node";
import { createBerkutchi } from "../src/berkutchi/scene.ts";

const { values } = parseArgs({
  options: {
    width: { type: "string", default: "1600" },
    height: { type: "string", default: "900" },
    at: { type: "string" },
    out: { type: "string" },
    poke: { type: "string" }, // "t,x,y": click at world (x, y) at t seconds
  },
});
const width = Number(values.width);
const height = Number(values.height);

async function load(name: string) {
  const entry = fileURLToPath(new URL(`../src/berkutchi/${name}.wgsl`, import.meta.url));
  return prepareShader(await resolveShader({ entry }), entry);
}
const shaders = { sky: await load("sky"), sim: await load("sim"), dots: await load("dots") };

const gpu = await vg.init({ requiredLimits: { maxStorageBuffersInVertexStage: 1 } });
const target = vg.target(gpu, { size: [width, height], format: "rgba8unorm" });

async function save(path: string) {
  const pixels = await target.color.read({ mipLevel: 0, region: "all" });
  const png = new PNG({ width, height });
  png.data.set(pixels);
  writeFileSync(path, PNG.sync.write(png));
  console.log("wrote", path);
}

const DT = 1 / 60;
function run(scene: ReturnType<typeof createBerkutchi>, seconds: number) {
  for (let t = 0; t < seconds; t += DT) {
    scene.update(DT);
    vg.frame(gpu, (f) => scene.encode(f, target));
  }
}

if (values.at) {
  const outDir = values.out ?? ".";
  mkdirSync(outDir, { recursive: true });
  const times = values.at.split(",").map(Number).sort((a, b) => a - b);
  const scene = createBerkutchi(vg, gpu, shaders);
  let now = 0;
  run(scene, 0.5);
  now = 0.5;
  scene.recall();
  const poke = values.poke?.split(",").map(Number);
  for (const t of times) {
    if (poke && poke[0] > now && poke[0] <= t) {
      run(scene, poke[0] - now);
      now = poke[0];
      scene.poke(poke[1], poke[2]);
    }
    run(scene, Math.max(0, t - now));
    now = t;
    await save(join(outDir, `berkutchi-${t}s.png`));
    console.log(`  t=${t}s cohesion=${scene.cohesion.toFixed(2)}`);
  }
} else {
  // Poster: the eagle together, mid-glide.
  const scene = createBerkutchi(vg, gpu, shaders, { assembled: true, startTime: 4 });
  run(scene, 3);
  const name = width < height ? "berkutchi-mobile" : "berkutchi";
  const png = values.out ?? fileURLToPath(new URL(`../public/${name}.png`, import.meta.url));
  await save(png);
  // Halftone PNGs are heavy; ship WebP when ImageMagick is around.
  const webp = png.replace(/\.png$/, ".webp");
  const res = spawnSync("magick", [png, "-quality", "80", webp], { stdio: "inherit" });
  if (res.status === 0) {
    rmSync(png);
    console.log("wrote", webp);
  } else {
    console.warn("ImageMagick not found; kept the PNG. Update Berkutchi.astro to point at it.");
  }
}

gpu.dispose();
