import { formatXaf } from "@catalog/contracts";
import {
  Badge,
  Button,
  Card,
  CardNote,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
} from "@catalog/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { type Article, api, messageDErreur, PanneReseau } from "../lib/api.ts";

/**
 * Le catalogue de la vendeuse.
 *
 * **Le reordonnancement se fait par boutons, pas par glisser-deposer.** Le
 * glisser-deposer est joli sur un portable et penible sur un telephone : il faut
 * viser, maintenir, faire defiler la page en meme temps. Il est de plus
 * inutilisable au clavier et au lecteur d'ecran, ce qui en ferait une violation du
 * critere WCAG 2.5.7. Deux boutons « monter » et « descendre » marchent partout.
 *
 * Les quatre etats obligatoires de tout ecran sont ici : chargement, vide,
 * erreur, **hors ligne**. Le dernier n'est pas une politesse — le reseau coupe
 * plusieurs fois par jour, et un catalogue vide affiche a la place du vrai
 * catalogue ferait croire a une perte de donnees.
 */
export function Articles() {
  return <Protege>{() => <Liste />}</Protege>;
}

type Etat =
  | { nom: "chargement" }
  | { nom: "prete"; articles: Article[] }
  | { nom: "erreur"; message: string }
  | { nom: "horsLigne" };

function Liste() {
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });
  const [archives, setArchives] = useState(false);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async (avecArchives: boolean) => {
    try {
      const r = await api.articles(avecArchives);
      if (!r.ok || !r.donnees) {
        setEtat({ nom: "erreur", message: messageDErreur(r, "Le catalogue n'a pas pu etre lu.") });
        return;
      }
      setEtat({ nom: "prete", articles: r.donnees.articles });
    } catch (cause) {
      setEtat(
        cause instanceof PanneReseau
          ? { nom: "horsLigne" }
          : { nom: "erreur", message: "Le catalogue n'a pas pu etre lu." },
      );
    }
  }, []);

  useEffect(() => {
    void charger(archives);
  }, [charger, archives]);

  /**
   * Deplace un article d'un cran et envoie l'ordre COMPLET.
   *
   * L'affichage est mis a jour d'abord : sur un reseau lent, une liste qui ne
   * bouge qu'apres l'aller-retour donne l'impression que le bouton ne marche pas,
   * et la vendeuse appuie plusieurs fois.
   */
  async function deplacer(index: number, sens: -1 | 1) {
    if (etat.nom !== "prete") return;
    const cible = index + sens;
    if (cible < 0 || cible >= etat.articles.length) return;

    const suivant = [...etat.articles];
    const [pris] = suivant.splice(index, 1);
    if (!pris) return;
    suivant.splice(cible, 0, pris);
    setEtat({ nom: "prete", articles: suivant });

    setOccupe(true);
    try {
      const r = await api.ordonnerArticles(suivant.map((a) => a.id));
      if (r.ok && r.donnees) setEtat({ nom: "prete", articles: r.donnees.articles });
      else await charger(archives);
    } catch {
      // L'ordre affiche n'est peut-etre pas celui de la base : on relit plutot
      // que de laisser la vendeuse devant un ordre qui n'existe pas.
      await charger(archives);
    } finally {
      setOccupe(false);
    }
  }

  async function basculerArchive(a: Article) {
    setOccupe(true);
    try {
      await (a.archive ? api.restaurerArticle(a.id) : api.archiverArticle(a.id));
      await charger(archives);
    } finally {
      setOccupe(false);
    }
  }

  const cadre = (contenu: React.ReactNode) => (
    <Ecran
      titre="Mes articles"
      surtitre="Catalogue"
      actions={<Button render={<Link to="/articles/nouveau" />}>Ajouter un article</Button>}
    >
      {contenu}
    </Ecran>
  );

  if (etat.nom === "chargement") return cadre(<LoadingState label="Lecture du catalogue…" />);

  if (etat.nom === "horsLigne") {
    return cadre(
      <OfflineState
        action={
          <Button tone="outline" onClick={() => void charger(archives)}>
            Reessayer
          </Button>
        }
      >
        Votre catalogue est toujours en ligne pour vos clientes. C'est seulement cet ecran qui
        n'arrive pas a le lire.
      </OfflineState>,
    );
  }

  if (etat.nom === "erreur") {
    return cadre(
      <ErrorState
        action={
          <Button tone="outline" onClick={() => void charger(archives)}>
            Reessayer
          </Button>
        }
      >
        {etat.message}
      </ErrorState>,
    );
  }

  if (etat.articles.length === 0) {
    return cadre(
      <EmptyState
        title="Aucun article pour l'instant"
        action={
          <Button render={<Link to="/articles/nouveau" />}>Ajouter mon premier article</Button>
        }
      >
        Une photo, un nom, un prix. C'est tout ce qu'il faut pour commencer.
      </EmptyState>,
    );
  }

  return cadre(
    <>
      <Button tone="ghost" onClick={() => setArchives((v) => !v)}>
        {archives ? "Masquer les articles archives" : "Afficher aussi les articles archives"}
      </Button>

      <ul className="flex list-none flex-col gap-3 p-0">
        {etat.articles.map((a, i) => (
          <li key={a.id}>
            <Card>
              <div className="flex items-start gap-3">
                {a.image ? (
                  <picture>
                    <source srcSet={a.image.avif} type="image/avif" />
                    <img
                      src={a.image.webp}
                      alt=""
                      width={a.image.largeur ?? 64}
                      height={a.image.hauteur ?? 64}
                      className="h-16 w-16 shrink-0 rounded-field object-cover"
                    />
                  </picture>
                ) : (
                  <div
                    aria-hidden="true"
                    className="h-16 w-16 shrink-0 rounded-field border border-dashed border-control-line"
                  />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="truncate text-body">{a.name}</CardTitle>
                    {a.archive ? <Badge tone="neutral">Archive</Badge> : null}
                  </div>
                  <p className="font-semibold text-ink">{formatXaf(a.priceXaf)}</p>
                  {a.image?.octets ? (
                    <CardNote>Photo de {Math.round(a.image.octets / 1000)} Ko</CardNote>
                  ) : (
                    <CardNote>Sans photo — une photo double les chances de vendre.</CardNote>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button tone="outline" render={<Link to={`/articles/${a.id}`} />}>
                  Modifier
                </Button>
                {/* Boutons et non glisser-deposer : utilisables au doigt, au
                    clavier et au lecteur d'ecran. */}
                <Button
                  tone="outline"
                  size="icon"
                  aria-label={`Monter ${a.name}`}
                  disabled={i === 0 || occupe || archives}
                  onClick={() => void deplacer(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  tone="outline"
                  size="icon"
                  aria-label={`Descendre ${a.name}`}
                  disabled={i === etat.articles.length - 1 || occupe || archives}
                  onClick={() => void deplacer(i, 1)}
                >
                  ↓
                </Button>
                <Button tone="ghost" disabled={occupe} onClick={() => void basculerArchive(a)}>
                  {a.archive ? "Remettre en vente" : "Archiver"}
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {archives ? (
        <CardNote>
          L'ordre ne se change pas quand les articles archives sont affiches : la liste montree
          n'est pas celle que voient vos clientes.
        </CardNote>
      ) : null}
    </>,
  );
}
