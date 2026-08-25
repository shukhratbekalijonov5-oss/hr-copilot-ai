import type { MetadataRoute } from "next";
import { PWA } from "@/lib/pwa/config";

/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * ## A route, not a static file
 *
 * `app/manifest.ts` is the framework's own convention, so the URL, the
 * content type and the `<link rel="manifest">` tag are all generated rather
 * than hand-maintained in three places that can disagree.
 *
 * ## Orientation is deliberately unlocked
 *
 * The brief allows `portrait-primary` only if the product genuinely needs it,
 * and it does not: every screen is responsive, the recruiting tables and the
 * compare view are easier to read in landscape, and a tablet in a stand is a
 * normal way to run a hiring review. Locking orientation would take that away
 * to solve a problem this product does not have.
 *
 * ## Icons are real files
 *
 * Every path here resolves to a PNG in `public/icons`, generated from the
 * product's own mark. `any` and `maskable` are declared separately because a
 * platform that crops to a circle needs art inside the safe zone, and one
 * that does not would render that same art too small.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PWA.name,
    short_name: PWA.shortName,
    description: PWA.description,
    start_url: "/",
    /*
     * `standalone`, not `fullscreen`: the product has real navigation and a
     * status bar is genuinely useful to somebody checking applications
     * between meetings. `fullscreen` would hide the clock and the battery to
     * gain 20px.
     */
    display: "standalone",
    scope: "/",
    background_color: PWA.backgroundColor,
    theme_color: PWA.themeColor,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
