import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * Standalone output, for the container image.
   *
   * Next traces the files each route actually needs and writes a
   * self-contained tree — including only the slice of `node_modules` that is
   * reachable — plus a minimal `server.js`. The runtime stage then copies
   * that tree and nothing else, so the shipped image never contains the
   * build toolchain, the dev dependencies or the source.
   *
   * `public/` and `.next/static` are deliberately NOT traced into it (Next
   * expects a CDN to serve them), so the Dockerfile copies both explicitly —
   * without that step the PWA's manifest, service worker and icons would be
   * missing from the image.
   */
  output: "standalone",
};

export default nextConfig;
