import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// L'app vendeuse est entierement derriere authentification : rien a mettre en
// cache cote CDN. Une coquille SPA mise en cache par le service worker demarre
// plus vite en visite repetee qu'un rendu serveur — et la vendeuse l'ouvre
// tous les jours.
export default defineConfig({
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Swap — espace vendeuse",
        short_name: "Swap",
        lang: "fr",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f6f5",
        theme_color: "#0e7a5f",
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,woff2}"] },
    }),
  ],
});
