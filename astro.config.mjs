// @ts-check
import { defineConfig } from "astro/config";
import { wgslVitePlugin } from "@vgpu/wgsl/loader-vite";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://aisafetykz.org",
  integrations: [sitemap()],
  vite: {
    // Prepares .wgsl imports at build time, so the browser never ships the WGSL parser.
    plugins: [wgslVitePlugin({ minify: true })],
  },
});
