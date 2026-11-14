# aisafetykz.org

Website for AI Safety Kazakhstan, an AI safety community in Astana. A single page built with [Astro](https://astro.build) and Bun.

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # static output in dist/
```

- Page: `src/pages/index.astro`
- Header, footer, layout: `src/components/`, `src/layouts/Base.astro`
- Colours and fonts: `src/styles/global.css`

## Berkutchi (the hero art)

A WebGPU piece built with [vgpu](https://vgpu.sh): a golden eagle made of halftone dots soars over the steppe under the
36-ray sun from the flag. The bird is posed in 3D each frame (jointed wings, a steering tail, a head that watches
the cursor) and seen in perspective. Left alone it slowly drifts apart; a click scatters it or calls it back.

- `src/berkutchi/scene.ts`: the scene, shared by the browser and the render script
- `src/berkutchi/*.wgsl`: sky (fullscreen halftone), sim (compute: the 3D flight rig), dots (instanced draw)
- `src/berkutchi/eagle-shape.ts`: the eagle, built feather by feather and sampled as a halftone grid
- `src/components/Berkutchi.astro`: the hero; the GPU code only loads when WebGPU is available

Browsers without WebGPU, or with reduced motion on, see a still image. After changing the scene, regenerate it:

```sh
bun run poster                                            # public/berkutchi.webp + berkutchi-mobile.webp
bun scripts/render-berkutchi.ts --at 1,4,24 --out frames  # frames over time, no browser needed
bunx vgpu check src/berkutchi/sim.wgsl                    # validate a shader
```

`bun run poster` renders on the local GPU (Dawn), and the WebP conversion uses ImageMagick (`magick`).
