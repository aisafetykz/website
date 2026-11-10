// Browser entry for the Berkutchi section. Everything here is progressive:
// without WebGPU, with reduced motion, or on any error, the poster image
// simply stays in place.

import * as vg from "vgpu";
import sky from "./sky.wgsl";
import sim from "./sim.wgsl";
import dots from "./dots.wgsl";
import { createBerkutchi, type Berkutchi } from "./scene";

export async function mount(root: HTMLElement) {
  const canvas = root.querySelector("canvas");
  if (!canvas || !("gpu" in navigator)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  let gpu: Awaited<ReturnType<typeof vg.init>>;
  let scene: Berkutchi;
  let surface: ReturnType<typeof vg.surface>;
  try {
    gpu = await vg.init({ requiredLimits: { maxStorageBuffersInVertexStage: 1 } });
    surface = vg.surface(gpu, canvas, { dpr: [1, 2] });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    scene = createBerkutchi(vg, gpu, { sky, sim, dots }, { dpr });
  } catch (err) {
    console.info("Berkutchi: showing the still image instead.", err);
    return;
  }

  let loop: { stop(): void } | undefined;
  let last = 0;
  let calledOnce = false;

  const start = () => {
    if (loop) return;
    last = performance.now();
    loop = vg.frameLoop(gpu, (frame) => {
      const now = performance.now();
      scene.update((now - last) / 1000);
      last = now;
      scene.encode(frame, surface);
      if (root.dataset.state !== "live") root.dataset.state = "live";
    });
  };
  const stop = () => {
    loop?.stop();
    loop = undefined;
  };

  // Only animate while on screen. The first time it appears, the dust
  // gathers into the eagle on its own.
  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        start();
        if (!calledOnce) {
          calledOnce = true;
          setTimeout(() => scene.recall(), 600);
        }
      } else {
        stop();
      }
    },
    { threshold: 0.15 },
  );
  io.observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else if (root.getBoundingClientRect().bottom > 0) start();
  });

  // Pointer: a gust of wind while hovering; a click scatters the eagle, or
  // calls it back if it has drifted apart.
  const toWorld = (e: PointerEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const aspect = r.width / r.height;
    return [((e.clientX - r.left) / r.width) * 2 * aspect - aspect, 1 - ((e.clientY - r.top) / r.height) * 2];
  };
  canvas.addEventListener("pointermove", (e) => {
    const [x, y] = toWorld(e);
    scene.setPointer(x, y, e.pointerType === "mouse");
  });
  canvas.addEventListener("pointerleave", () => scene.setPointer(0, 0, false));
  canvas.addEventListener("click", (e) => {
    const [x, y] = toWorld(e);
    scene.poke(x, y);
  });
}
