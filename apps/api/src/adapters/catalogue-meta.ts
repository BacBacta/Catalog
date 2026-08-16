import type { FicheCatalogue, SynchroniseurCatalogue } from "../domain/catalogue.ts";
import { fetchBorne } from "./fetch-borne.ts";

/**
 * La synchronisation du catalogue Commerce Manager — ADR 0108.
 *
 * Un seul catalogue pour tout le numero : `retailer_id` est l'identifiant de
 * l'article EN BASE, et c'est la decision qui evite toute table de
 * correspondance. Seuls les articles ILLUSTRES se synchronisent — une fiche
 * sans image dans une vitrine d'images ferait moins bien que la liste
 * interactive, qui reste le repli (ADR 0107).
 *
 * L'envoi passe par `items_batch`, en `UPDATE` : chez Meta, `UPDATE` cree la
 * fiche absente et remplace la presente — c'est ce qui rend la
 * synchronisation IDEMPOTENTE, donc rejouable sans compter.
 *
 * Les montants sont des entiers XAF (AGENTS.md) et le franc CFA n'a pas de
 * sous-unite : le prix part tel quel, jamais multiplie par cent.
 */

export interface CatalogueConfig {
  /** Jeton Graph — le meme que les Flows (`WABOT_API_KEY`). */
  apiKey: string;
  /** L'identifiant du catalogue Commerce Manager (`WABOT_CATALOGUE_ID`). */
  catalogueId: string;
  /** `https://graph.facebook.com/v26.0` — remplacable pour les tests. */
  graphUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export class CatalogueMeta implements SynchroniseurCatalogue {
  readonly nom = "meta";
  readonly #cfg: CatalogueConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: CatalogueConfig) {
    if (!cfg.apiKey) throw new Error("CatalogueMeta : apiKey manquante");
    if (!cfg.catalogueId) throw new Error("CatalogueMeta : catalogueId manquant");
    this.#cfg = cfg;
    /* Borne : un appel du bot echoue ou finit, jamais « il attend ». */
    this.#fetch = fetchBorne(cfg.fetchImpl ?? fetch);
  }

  async pousser(fiches: readonly FicheCatalogue[]): Promise<void> {
    if (fiches.length === 0) return;
    await this.#lot(
      fiches.map((f) => ({
        method: "UPDATE",
        data: {
          id: f.id,
          title: f.nom,
          /* Meta refuse la description vide : le nom fait alors l'affaire. */
          description: f.description?.trim() || f.nom,
          /* XAF est sans sous-unite (ISO 4217, exposant zero) : l'entier part
             tel quel. « 15000 XAF », jamais « 1500000 ». */
          price: `${f.prixXaf} XAF`,
          availability: f.disponible ? "in stock" : "out of stock",
          condition: "new",
          image_link: f.imageUrl,
          link: f.lienBoutique,
        },
      })),
    );
  }

  async retirer(articleIds: readonly string[]): Promise<void> {
    if (articleIds.length === 0) return;
    await this.#lot(articleIds.map((id) => ({ method: "DELETE", data: { id } })));
  }

  async #lot(requests: unknown[]): Promise<void> {
    const base = (this.#cfg.graphUrl ?? "https://graph.facebook.com/v26.0").replace(/\/$/, "");
    const reponse = await this.#fetch(`${base}/${this.#cfg.catalogueId}/items_batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.#cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ item_type: "PRODUCT_ITEM", requests }),
    });
    if (!reponse.ok) {
      /* Le corps d'erreur Graph est court et sans secret : il porte le code
         et le message Meta, exactement ce qu'un journal doit dire. */
      const corps = await reponse.text().catch(() => "");
      throw new Error(
        `catalogue Meta : lot refuse (HTTP ${reponse.status}) ${corps.slice(0, 300)}`,
      );
    }
  }
}
