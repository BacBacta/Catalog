import { Hono } from "hono";
import type { MemoryStorage } from "../adapters/storage-s3.ts";

/**
 * Service des objets du stockage EN MEMOIRE.
 *
 * Il n'existe que pour le developpement et les tests : avec un vrai S3 ou R2,
 * l'URL signee pointe directement chez le fournisseur et cette route ne se monte
 * pas. C'est ce qui permet de parcourir toute la chaine d'images — televersement,
 * re-encodage, affichage — sans MinIO ni compte S3.
 *
 * Elle verifie tout de meme l'echeance portee par le lien. Non pas parce qu'elle
 * protege quoi que ce soit en developpement, mais parce qu'un lien sans echeance
 * fonctionnerait en developpement et casserait le jour de la bascule vers S3 :
 * l'ecran doit apprendre tout de suite que ces URL expirent.
 */
export function mediaRoutes(storage: MemoryStorage): Hono {
  return new Hono().get("/*", async (c) => {
    const chemin = c.req.path.replace(/^\/api\/media\//, "");
    const exp = Number(c.req.query("exp") ?? 0);
    if (!Number.isFinite(exp) || exp <= 0) {
      return c.json({ erreur: "lien_non_signe" }, 403);
    }
    if (exp * 1000 < Date.now()) {
      return c.json({ erreur: "lien_expire" }, 410);
    }

    const objet = storage.objets.get(chemin);
    if (!objet) return c.json({ erreur: "objet_introuvable" }, 404);

    return new Response(objet.corps, {
      headers: {
        "content-type": objet.contentType,
        "content-length": String(objet.corps.length),
        "cache-control": objet.cacheControl ?? "private, max-age=60",
      },
    });
  });
}
