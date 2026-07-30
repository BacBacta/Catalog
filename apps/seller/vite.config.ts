import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// L'app vendeuse est entierement derriere authentification : rien a mettre en
// cache cote CDN. Une coquille SPA mise en cache par le service worker demarre
// plus vite en visite repetee qu'un rendu serveur — et la vendeuse l'ouvre
// tous les jours.
/**
 * `/api` est renvoye vers l'API en developpement ET en preproduction.
 *
 * Ce n'est pas un confort : le cookie de session pose par Better Auth doit etre
 * de MEME ORIGINE. Un appel direct vers un autre port en ferait un cookie tiers,
 * bloque par defaut sur les navigateurs mobiles courants — la vendeuse serait
 * deconnectee a chaque ouverture, sans message d'erreur pour l'expliquer.
 *
 * En production, le renvoi est fait par le serveur de tete, pas ici.
 */
const proxy = {
  "/api": {
    target: process.env.API_ORIGIN ?? "http://127.0.0.1:8787",
    changeOrigin: false,
  },
};

export default defineConfig({
  server: { proxy },
  preview: { proxy },
  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Catalog — espace vendeuse",
        short_name: "Catalog",
        lang: "fr",
        start_url: "/",
        display: "standalone",
        background_color: "#f4f6f5",
        theme_color: "#0e7a5f",
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // Sans cette exclusion, une navigation vers /api renverrait la coquille
        // SPA depuis le cache : l'appel d'API recevrait du HTML et echouerait
        // sans rien qui explique pourquoi.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
});
