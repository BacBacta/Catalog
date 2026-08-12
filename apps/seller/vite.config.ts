import { copyFileSync } from "node:fs";
import { join } from "node:path";
import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
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

/**
 * `vercel.json` est un fichier SOURCE, et il doit arriver a DEUX endroits.
 *
 * Mesure du 11/08/2026 : Vercel lit sa configuration a la racine du repertoire
 * qu'on lui DEPLOIE, et ce repertoire n'est pas le meme selon le chemin.
 *
 * | chemin de deploiement            | racine lue par Vercel |
 * |----------------------------------|------------------------|
 * | `cd dist && vercel deploy`       | `dist/`                |
 * | construction depuis git          | `apps/seller/`         |
 *
 * Le premier est celui du runbook. Le second s'est ouvert le jour ou le projet
 * a ete relie au depot, et il ne lisait RIEN : le fichier vivait dans `public/`,
 * donc n'existait qu'apres construction. Constate sur un deploiement reel —
 * l'application etait servie, mais `/commandes` rendait 404, `/api/*` n'etait
 * plus renvoye vers Fly, et aucun en-tete de securite ne sortait. **Sans la
 * moindre erreur de construction**, exactement la panne que ce fichier existe
 * pour empecher.
 *
 * Le fichier vit donc a la racine de l'app — la ou la construction git le lit —
 * et ce greffon le recopie dans `dist/`, pour l'autre chemin. Une seule source,
 * deux destinations : `src/__tests__/vercel-json.test.ts` verifie qu'elles ne
 * divergent pas.
 */
const vercelJsonDansLaSortie = (): Plugin => ({
  name: "catalog:vercel-json",
  apply: "build",
  closeBundle() {
    copyFileSync(
      join(import.meta.dirname, "vercel.json"),
      join(import.meta.dirname, "dist/vercel.json"),
    );
  },
});

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
        // Les `maskable` sont a part : Android decoupe l'icone dans un cercle
        // ou un carre arrondi selon le lanceur, et le motif vit dans la zone
        // sure de 80 %. Une seule icone `any` etiree en maskable perdrait ses
        // coins — c'est l'installation PWA qui fait de l'app « une vraie
        // app » sur le telephone d'une vendeuse.
        icons: [
          { src: "/icones/icone-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icones/icone-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icones/maskable-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icones/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        // Sans cette exclusion, une navigation vers /api renverrait la coquille
        // SPA depuis le cache : l'appel d'API recevrait du HTML et echouerait
        // sans rien qui explique pourquoi.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    vercelJsonDansLaSortie(),
  ],
});
