// Berkutchi: the eagle and the hand.
//
// A golden eagle made of halftone dots soars over the steppe. Left alone, it
// slowly comes apart into the wind; a click calls it back. Kazakh berkutchi
// have trained golden eagles for centuries: a powerful, wild intelligence that
// is free to fly away and chooses to return. That is the picture of alignment
// this piece is about.
//
// This module is runtime-agnostic: the browser passes `vgpu`, the poster
// script passes `vgpu/node`, and both pass prepared shaders.

import type * as V from "vgpu";
import { eaglePoints } from "./eagle-shape";

type Api = Pick<typeof V, "compute" | "draw" | "effect" | "storage">;
type Shader = Parameters<typeof V.effect>[1];
type Gpu = V.Gpu;
type Frame = V.Frame;
type Target = V.Target;

export type Shaders = { sky: Shader; sim: Shader; dots: Shader };

const AMBIENT = 1400; // drifting motes that never join the eagle
const HOLD = 9; // seconds the eagle stays together after a call
const FADE = 16; // seconds it takes to come apart again
const WG = 64;

export interface Berkutchi {
  /** Call the eagle back (when it has drifted apart). */
  recall(): void;
  /** A click at world point (x, y): scatters the eagle there if it's together, calls it back if it isn't. */
  poke(x: number, y: number): void;
  /** Advance the controller; call once per frame with seconds since last frame. */
  update(dt: number): void;
  /** Encode the simulation and draw into `target`. */
  encode(frame: Frame, target: Target): void;
  setPointer(x: number, y: number, on: boolean): void;
  readonly cohesion: number;
  readonly count: number;
  dispose(): void;
}

export interface Options {
  dpr?: number;
  /** Start with the eagle already together (posters, reduced motion). */
  assembled?: boolean;
  /** Fix the clock, for deterministic stills. */
  startTime?: number;
}

export function createBerkutchi(api: Api, gpu: Gpu, shaders: Shaders, opts: Options = {}): Berkutchi {
  const SPACING = 0.0165; // eagle-local units between halftone dots
  const eagle = eaglePoints(SPACING);
  const count = eagle.length + AMBIENT;
  const dpr = opts.dpr ?? 1;

  // Deterministic random for initial scatter and motes.
  let s = 7;
  const rand = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;

  const particles = new Float32Array(count * 4);
  eagle.forEach((p, i) => particles.set([p.x, p.y, p.tone, p.seed], i * 4));
  for (let i = eagle.length; i < count; i++) {
    particles.set([0, 0, -(0.5 + rand() * 0.9), rand()], i * 4);
  }

  // Start scattered across the sky like dust.
  const initial = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    initial.set([(rand() * 2 - 1) * 2.4, -0.3 + rand() * 1.3, 0, 0], i * 4);
  }

  const particleBuf = api.storage(gpu, particles.byteLength, "read");
  particleBuf.write(particles);
  const stateBuf = api.storage(gpu, initial.byteLength, "read-write");
  stateBuf.write(initial);
  const spriteBuf = api.storage(gpu, count * 16, "read-write");

  const sim = api.compute(gpu, shaders.sim, { label: "berkutchi-sim" });
  const sky = api.effect(gpu, shaders.sky, { label: "berkutchi-sky" });
  const dots = api.draw(gpu, {
    shader: shaders.dots,
    label: "berkutchi-dots",
    vertices: 6,
    instances: count,
    blend: "alpha",
  });
  sim.set({ particles: particleBuf, state: stateBuf, sprites: spriteBuf });
  dots.set({ sprites: spriteBuf });

  // Controller state (CPU side).
  let time = opts.startTime ?? 0;
  let lastRecall = opts.assembled ? time : -1e9;
  let cohesion = opts.assembled ? 1 : 0;
  let flap = 0;
  let flapBoost = opts.assembled ? 0 : 1;
  let pointer: [number, number] = [0, 0];
  let kickAt: [number, number] = [0, 0];
  let kick = 0;
  let kickNow = false;
  let pointerOn = false;
  let stepDt = 0;
  let aspect = 16 / 9;

  function cohesionGoal(): number {
    const since = time - lastRecall;
    if (since < HOLD) return 1;
    const t = Math.min(1, (since - HOLD) / FADE);
    return 1 - t * t * (3 - 2 * t);
  }

  // The page text sits over the left side (wide screens) or the bottom
  // (portrait), so the sun and the eagle keep to the other part of the frame,
  // stacked like the flag: sun above, eagle below.
  function layout() {
    const w = 0.09;
    const wide = aspect > 1.1;
    const bank = -0.1 * Math.cos(time * w);
    if (wide) {
      // Keep to the right: proportionally on wide screens, by the edge on squarer ones.
      const cx = Math.max(0.42 * aspect, aspect - 0.72);
      const scale = Math.min(0.58, aspect * 0.3) * (0.96 + 0.04 * Math.cos(time * w));
      return {
        x: cx + Math.min(0.06 * aspect, 0.1) * Math.sin(time * w),
        y: -0.17 + 0.04 * Math.sin(time * w * 2 + 0.7),
        scale,
        bank,
        sun: [cx, 0.3] as [number, number],
        sunScale: 0.66,
      };
    }
    const scale = Math.min(0.5, aspect * 0.52) * (0.96 + 0.04 * Math.cos(time * w));
    return {
      x: 0.06 * aspect * Math.sin(time * w),
      y: 0.4 + 0.03 * Math.sin(time * w * 2 + 0.7),
      scale,
      bank,
      sun: [0.1 * aspect, 0.66] as [number, number],
      sunScale: 0.42,
    };
  }

  return {
    get cohesion() {
      return cohesion;
    },
    count,
    recall() {
      lastRecall = time;
      flapBoost = 1;
    },
    poke(x, y) {
      if (cohesion > 0.6) {
        kickAt = [x, y];
        kick = 1;
        kickNow = true;
      }
      lastRecall = time;
      flapBoost = 1;
    },
    setPointer(x, y, on) {
      pointer = [x, y];
      pointerOn = on;
    },
    update(dt) {
      stepDt = Math.min(Math.max(dt, 0), 1 / 30);
      time += stepDt;
      const goal = cohesionGoal();
      // Gather quickly, come apart slowly.
      const rate = goal > cohesion ? 0.9 : 0.25;
      cohesion += Math.sign(goal - cohesion) * Math.min(Math.abs(goal - cohesion), rate * stepDt);
      flapBoost = Math.max(0, flapBoost - stepDt * 0.25);
      kick = Math.max(0, kick - stepDt * 0.6); // about 1.7 s to regather
      flap += stepDt * (1.6 + 4.5 * flapBoost);
    },
    encode(frame, target) {
      const [w, h] = target.size;
      aspect = w / h;
      const f = layout();
      // Mostly soaring; a few beats now and then, and hard beats after a call.
      const idleBeat = Math.max(0, Math.sin(time * 0.35)) ** 8;
      const flapAmp = 0.06 + 0.25 * idleBeat + 0.45 * flapBoost;

      sim.set({
        params: {
          center: [f.x, f.y],
          pointer,
          kickAt,
          kickNow: kickNow ? 1 : 0,
          kick,
          time,
          dt: stepDt,
          aspect,
          cohesion,
          scale: f.scale,
          bank: f.bank,
          flap,
          flapAmp,
          pointerOn: pointerOn ? 1 : 0,
          // one halftone cell of the eagle, in device pixels
          dotSize: SPACING * f.scale * (h / 2),
          count,
        },
      });
      sky.set({
        sky: {
          resolution: [w, h],
          sun: f.sun,
          sunScale: f.sunScale,
          time,
          cell: Math.max(5, Math.round(6 * dpr)),
          horizon: -0.5,
          glow: cohesion,
        },
      });
      dots.set({ view: { resolution: [w, h] } });
      kickNow = false;

      frame.computePass((pass) => pass.dispatch(sim, Math.ceil(count / WG)));
      frame.pass(target, (pass) => {
        pass.draw(sky);
        pass.draw(dots);
      });
    },
    dispose() {
      sim.dispose();
      sky.dispose?.();
      dots.dispose?.();
    },
  };
}
