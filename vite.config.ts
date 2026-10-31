import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// Installable app (PWA). The service worker caches the app so it opens instantly and offline; a new deploy shows an
// "Update available" bar (registerType "prompt") instead of swapping versions under someone mid-session.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icons/*.png", "brand/*.png"],
      manifest: {
        name: "WVU Pitch Tunneling",
        short_name: "Pitch Tunneling",
        description: "WVU Baseball pitch tunneling and sequencing",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0b1526",
        theme_color: "#0b1526",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        globIgnores: ["data/**"],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/data\//, /^\/models\//],
        runtimeCaching: [
          // pitch data: fresh when online, last copy when not
          { urlPattern: ({ url }) => url.pathname.startsWith("/data/"), handler: "NetworkFirst",
            options: { cacheName: "data", networkTimeoutSeconds: 6, expiration: { maxEntries: 300 } } },
          { urlPattern: ({ url }) => url.pathname === "/api/weather", handler: "NetworkFirst",
            options: { cacheName: "weather", networkTimeoutSeconds: 6, expiration: { maxEntries: 500 } } },
          // body-tracking model for Align: big and never changes
          { urlPattern: ({ url }) => url.pathname.startsWith("/models/"), handler: "CacheFirst",
            options: { cacheName: "models", expiration: { maxEntries: 20 } } },
          { urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com",
            handler: "StaleWhileRevalidate", options: { cacheName: "fonts", expiration: { maxEntries: 20 } } },
          // AWRE video and lookups are never cached (always live)
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 900 },
});
