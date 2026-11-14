# aisafetykz.org

Website for AI Safety Kazakhstan, an AI safety community in Astana. A single page built with [Astro](https://astro.build) and Bun.

```sh
bun install
bun run dev      # http://localhost:4321
bun run build    # static output in dist/
```

- Page: `src/pages/index.astro`
- Hero, footer, layout: `src/components/`, `src/layouts/Base.astro`
- Colours and fonts: `src/styles/global.css`

## Baiterek (the hero art)

The Baiterek tower in Astana, set entirely in characters: every cell of a text grid holds one character of a stream
of weights (`0.4817-0.0923 0.3301`). It is one WebGL2 fragment shader on a canvas behind the hero's text.

- **Arrival:** as in the legend, the tree of life grows up from the ground, then the golden egg appears in its crown.
- **Shading:** the sphere and trunk are lit as round surfaces, with heavier digits in shadow and lighter ones in light.
- **Signals:** every few seconds a pulse climbs the trunk, fans out along the branches and lights the sphere.
- **Hidden words:** now and then a row of the trunk resolves into a phrase and turns back into numbers.
- **Sky:** faint beams of light and drifting clouds, which keep clear of the page's text.
- **Samruk:** the bird of the legend occasionally flies in, circles the crown and leaves.
- **Snow:** it snows when it is really snowing in Astana (asked of [Open-Meteo](https://open-meteo.com) on load).
  Add `?snow=1` to the address to see it anyway.
- **Pointer:** a small spot follows it and stirs the weights; a click sends a rough ring across the page and, on the
  tower, a signal from that point.

The files:

- `src/baiterek/shape.ts`: the tower's outline, drawn to a small canvas the shader reads as coverage
- `src/baiterek/weights.frag`: the shader, which does everything listed above
- `src/baiterek/client.ts`: placement around the page's text, the pointer, the weather, Samruk's flight
- `src/components/Hero.astro`: the hero's layout, with the canvas

Without WebGL2 the hero is simply plain. With reduced motion on, the tower is drawn once, fully grown and still.
