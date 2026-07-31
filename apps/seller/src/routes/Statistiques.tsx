import type { EtapeEntonnoir, PointSerie, StatsVendeuse } from "@catalog/contracts/stats";
import {
  BarreEmpilee,
  Barres,
  Button,
  Card,
  CardNote,
  CardTitle,
  Courbe,
  EmptyState,
  ErrorState,
  empiler,
  Graphique,
  jourCourt,
  LoadingState,
  nombre,
  OfflineState,
  StatTile,
} from "@catalog/ui";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { api, messageDErreur } from "../lib/api.ts";

/**
 * Les chiffres de la vendeuse.
 *
 * **L'ecran commence par la part des ventes prouvees et pas par le trafic.**
 * C'est l'indicateur qui mesure le produit lui-meme : Catalog ne vaut que si les
 * vendeuses collent leurs SMS, et une part qui s'effondre ne dit pas « les
 * vendeuses sont paresseuses », elle dit « le produit ne tient pas sa promesse ».
 * Le mettre en tete n'est pas une hierarchie visuelle, c'est la these du produit
 * ecrite en chiffres.
 *
 * Trois regles de trace tenues ici, et pas seulement dans les composants :
 *
 * - **le selecteur de periode est au-dessus de TOUT** et cadre les cinq blocs a
 *   la fois. Un filtre par graphique laisserait lire deux chiffres pris sur deux
 *   fenetres differentes comme s'ils se comparaient ;
 * - **chaque graphique porte sa vue tableau**, obtenue en donnant ses colonnes
 *   et ses lignes a `Graphique` — qui les exige ;
 * - **aucune bibliotheque de graphiques.** Un `<svg>` pour la courbe, des boites
 *   en CSS pour les barres. Un test refuse toute dependance qui en serait une.
 */

const FENETRES = [
  { jours: 7, libelle: "7 jours" },
  { jours: 30, libelle: "30 jours" },
  { jours: 90, libelle: "90 jours" },
] as const;

export function Statistiques() {
  return <Protege>{(v) => (v.seller ? <Chiffres /> : <SansBoutique />)}</Protege>;
}

type Etat =
  | { nom: "chargement" }
  | { nom: "hors_ligne" }
  | { nom: "erreur"; message: string }
  | { nom: "prete"; stats: StatsVendeuse };

function Chiffres() {
  const [jours, setJours] = useState<number>(30);
  const [etat, setEtat] = useState<Etat>({ nom: "chargement" });

  const charger = useCallback(async (fenetre: number) => {
    setEtat({ nom: "chargement" });
    try {
      const r = await api.statistiques(fenetre);
      if (!r.ok || !r.donnees) {
        setEtat({
          nom: "erreur",
          message: messageDErreur(r, "Les chiffres n'ont pas pu etre lus."),
        });
        return;
      }
      setEtat({ nom: "prete", stats: r.donnees });
    } catch {
      setEtat({ nom: "hors_ligne" });
    }
  }, []);

  useEffect(() => {
    void charger(jours);
  }, [charger, jours]);

  return (
    <Ecran titre="Vos chiffres" surtitre="Statistiques">
      {/*
        UNE rangee de filtres, au-dessus de tout ce qu'elle cadre. Des boutons a
        `aria-pressed` plutot que des onglets : il n'y a pas de panneaux a
        montrer et a cacher, il y a une meme page recalculee sur une autre
        periode — et un lecteur d'ecran doit entendre « active », pas
        « selectionne ».

        `<fieldset>` et non `<div role="group">` : l'element natif porte deja le
        role, et sa `<legend>` le nomme sans qu'on recopie le libelle dans un
        `aria-label` qui divergerait. La legende est masquee visuellement — le
        groupe se lit a l'oeil, il n'a besoin d'un nom que pour qui ne le voit
        pas.
      */}
      <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
        <legend className="sr-only">Période observée</legend>
        {FENETRES.map((f) => (
          <Button
            key={f.jours}
            tone={f.jours === jours ? "primary" : "outline"}
            aria-pressed={f.jours === jours}
            onClick={() => setJours(f.jours)}
          >
            {f.libelle}
          </Button>
        ))}
      </fieldset>

      {etat.nom === "chargement" ? (
        <LoadingState label="Lecture de vos chiffres…" lines={5} />
      ) : null}

      {etat.nom === "hors_ligne" ? (
        <OfflineState
          action={
            <Button tone="outline" onClick={() => void charger(jours)}>
              Reessayer
            </Button>
          }
        >
          Vos chiffres se lisent en ligne. Le reste de votre espace reste utilisable.
        </OfflineState>
      ) : null}

      {etat.nom === "erreur" ? (
        <ErrorState
          action={
            <Button tone="outline" onClick={() => void charger(jours)}>
              Reessayer
            </Button>
          }
        >
          {etat.message}
        </ErrorState>
      ) : null}

      {etat.nom === "prete" ? <Tableaux stats={etat.stats} /> : null}
    </Ecran>
  );
}

function Tableaux({ stats }: { stats: StatsVendeuse }) {
  const { periode } = stats;
  const surLaPeriode = `Du ${jourCourt(periode.du)} au ${jourCourt(periode.au)}.`;

  return (
    <>
      <PartProuvee stats={stats} periode={surLaPeriode} />
      <Entonnoir etapes={stats.entonnoir} periode={surLaPeriode} />
      <Vues stats={stats} periode={surLaPeriode} />
      <Commandes serie={stats.commandesParJour} periode={surLaPeriode} />
      <ArticlesLesPlusVus stats={stats} periode={surLaPeriode} />
      <SourcesDeTrafic />
    </>
  );
}

/* ══════════════════ 1. la part des ventes prouvees ══════════════════ */

/**
 * Le chiffre qui ouvre l'ecran, et le seul en corps de titre.
 *
 * Il se lit sans explication : un grand pourcentage, puis une barre qui le
 * decompose en trois. `contresigne` est le pas le plus appuye de la teinte
 * — deux voix independantes sur le meme identifiant d'operateur, c'est la preuve
 * la plus forte du produit —, `prouve` le pas moyen, et `non trace` un GRIS DE
 * RECUL.
 *
 * Le gris n'est pas un rouge attenue. Un depot direct declare a la main n'est
 * pas une faute : il compte, il n'est simplement pas prouve. Le peindre en
 * danger accuserait la vendeuse d'un fait qui n'est pas etabli.
 */
function PartProuvee({ stats, periode }: { stats: StatsVendeuse; periode: string }) {
  const p = stats.partVentesProuvees;
  const segments = empiler([
    { cle: "contresigne", valeur: p.contresigne },
    { cle: "prouve", valeur: p.prouve },
    { cle: "nonTrace", valeur: p.nonTrace },
  ]).map((s, i) => ({
    ...s,
    libelle: ["Contresigné par l'acheteuse", "Prouvé par SMS", "Non tracé"][i] as string,
    couleur: [
      "var(--color-preuve-contresigne)",
      "var(--color-preuve-prouve)",
      "var(--color-preuve-non-trace)",
    ][i] as string,
    pourcent: Math.round(s.largeur),
  }));

  return (
    <Card>
      {/*
        `null` et non zero quand rien n'est mesurable. Zero se lirait « aucune de
        mes ventes n'est prouvee », alors que la verite est « je n'ai encore rien
        vendu sur cette periode ». Un chiffre par defaut est un mensonge par
        defaut.
      */}
      <StatTile
        label="Part de vos ventes prouvées"
        value={
          p.pourcent === null ? (
            <span className="text-title font-bold text-ink-2">Rien à mesurer</span>
          ) : (
            <span className="text-hero font-bold text-ink">{p.pourcent}&nbsp;%</span>
          )
        }
        note={
          p.pourcent === null
            ? "Aucune vente sur cette période. Ce chiffre apparaîtra à la première."
            : `Sur ${nombre(p.total)} vente${p.total > 1 ? "s" : ""} : ce qui est prouvé par un SMS d'opérateur, contre-signature comprise.`
        }
        data-testid="tuile-part-prouvee"
      />

      <Graphique
        titre="Comment vos ventes sont prouvées"
        note={`${periode} Une vente prouvée donne droit à un reçu vérifiable et à un avis « achat vérifié ».`}
        resume={
          p.total === 0
            ? "Aucune vente retenue sur la période."
            : `${nombre(p.total)} ventes : ${nombre(p.contresigne)} contresignées, ${nombre(p.prouve)} prouvées par SMS, ${nombre(p.nonTrace)} non tracées.`
        }
        colonnes={["Comment", "Ventes", "Part"]}
        lignes={segments.map((s) => ({
          cle: s.cle,
          entete: s.libelle,
          cellules: [nombre(s.valeur), `${s.pourcent} %`],
        }))}
      >
        {p.total === 0 ? (
          <EmptyState title="Aucune vente sur la période">
            Dès votre première commande payée, cette barre montrera ce qui est prouvé et ce qui ne
            l'est pas.
          </EmptyState>
        ) : (
          <BarreEmpilee segments={segments} />
        )}
      </Graphique>

      {p.nonTrace > 0 ? (
        <CardNote>
          {nombre(p.nonTrace)} vente{p.nonTrace > 1 ? "s" : ""} déclarée
          {p.nonTrace > 1 ? "s" : ""} à la main, sans SMS. Elle
          {p.nonTrace > 1 ? "s comptent" : " compte"}, mais n'ouvre
          {p.nonTrace > 1 ? "nt" : ""} droit ni au reçu ni à l'avis vérifié.{" "}
          <Link to="/commandes" className="font-semibold text-brand-500 underline">
            Voir mes commandes
          </Link>
        </CardNote>
      ) : null}
    </Card>
  );
}

/* ══════════════════ 2. l'entonnoir ══════════════════ */

/**
 * Les quatre marches, et le taux de passage de chacune sur la PRECEDENTE.
 *
 * Rapporte au sommet, tout ressemble a une hemorragie et on ne voit plus ou ca
 * fuit. Rapporte a l'etape d'avant, la marche qui casse se lit d'un coup d'oeil
 * — et c'est la seule lecture qui mene a une action. C'est cette marche-la, la
 * plus faible, qui recoit l'emphase : le reste est en retrait.
 */
function Entonnoir({ etapes, periode }: { etapes: EtapeEntonnoir[]; periode: string }) {
  const RAMPE = [
    "var(--color-etape-1)",
    "var(--color-etape-2)",
    "var(--color-etape-3)",
    "var(--color-etape-4)",
  ];
  const faible = marcheLaPlusFaible(etapes);

  return (
    <Card>
      <Graphique
        titre="De la vue à la preuve"
        note={`${periode} Chaque taux se rapporte à l'étape juste avant, pas au total.`}
        resume={etapes
          .map((e) => `${e.libelle} : ${nombre(e.valeur)}`)
          .join(", ")
          .concat(".")}
        colonnes={["Étape", "Nombre", "Depuis l'étape avant"]}
        lignes={etapes.map((e) => ({
          cle: e.cle,
          entete: e.libelle,
          cellules: [
            nombre(e.valeur),
            e.pourcentPrecedent === null ? "—" : `${e.pourcentPrecedent} %`,
          ],
        }))}
      >
        <Barres
          items={etapes.map((e) => ({
            cle: e.cle,
            libelle: e.libelle,
            valeur: e.valeur,
            emphase: e.cle === faible?.cle,
            apres:
              e.pourcentPrecedent === null
                ? undefined
                : `${e.pourcentPrecedent} % de l'étape avant`,
          }))}
          couleurs={RAMPE}
        />
      </Graphique>

      {faible ? (
        <CardNote data-testid="marche-faible">
          C'est entre <strong className="text-ink">{faible.avant}</strong> et{" "}
          <strong className="text-ink">{faible.libelle.toLowerCase()}</strong> que vous perdez le
          plus : {faible.pourcentPrecedent}&nbsp;% seulement passent cette étape.
        </CardNote>
      ) : null}
    </Card>
  );
}

/**
 * La marche ou l'entonnoir se resserre le plus, ou `null` s'il n'y a rien a
 * dire — pas de donnee, ou aucune perte. On ne designe pas un coupable par
 * defaut : sur un entonnoir vide, la phrase serait fausse et inquietante.
 */
function marcheLaPlusFaible(
  etapes: EtapeEntonnoir[],
): (EtapeEntonnoir & { pourcentPrecedent: number; avant: string }) | null {
  let pire: (EtapeEntonnoir & { pourcentPrecedent: number; avant: string }) | null = null;
  for (const [i, e] of etapes.entries()) {
    const avant = etapes[i - 1];
    if (e.pourcentPrecedent === null || !avant || avant.valeur === 0) continue;
    if (e.pourcentPrecedent >= 100) continue;
    if (!pire || e.pourcentPrecedent < pire.pourcentPrecedent) {
      pire = { ...e, pourcentPrecedent: e.pourcentPrecedent, avant: avant.libelle.toLowerCase() };
    }
  }
  return pire;
}

/* ══════════════════ 3. les vues par jour ══════════════════ */

function Vues({ stats, periode }: { stats: StatsVendeuse; periode: string }) {
  const total = stats.vuesParJour.reduce((s, p) => s + p.valeur, 0);

  return (
    <Card>
      <CourbeJournaliere
        titre="Vues de vos articles"
        note={periode}
        unite="vues"
        colonneValeur="Vues"
        serie={stats.vuesParJour}
      />

      {/*
        Ce que la mesure NE SAIT PAS, dit en clair.

        La boutique publique est un site statique servi par un CDN : rien ne
        previent l'API quand une page s'ouvre. Sans cet avertissement, une
        vendeuse lirait « 0 vue » comme « personne ne regarde ma boutique » et
        prendrait une decision commerciale sur un chiffre qui n'a jamais ete
        mesure. Un chiffre faux est pire qu'un chiffre absent.
      */}
      {!stats.instrumentation.vuesInstrumentees ? (
        <CardNote data-testid="vues-non-instrumentees">
          <strong className="text-ink">Ces vues ne sont pas encore comptées.</strong> Votre boutique
          publique ne nous prévient pas encore quand une cliente ouvre une page. Tant que ce sera le
          cas, ce chiffre restera à zéro — ce n'est pas votre fréquentation.
          {total > 0 ? " Les valeurs affichées viennent de données de démonstration." : ""}
        </CardNote>
      ) : null}
    </Card>
  );
}

/* ══════════════════ 4. les commandes par jour ══════════════════ */

function Commandes({ serie, periode }: { serie: PointSerie[]; periode: string }) {
  return (
    <Card>
      <CourbeJournaliere
        titre="Commandes reçues"
        note={periode}
        unite="commandes"
        colonneValeur="Commandes"
        serie={serie}
      />
    </Card>
  );
}

/**
 * Le cadre commun aux deux series journalieres.
 *
 * **Aucune journee n'est sautee** : le serveur comble les trous a zero, et c'est
 * ce qui empeche la courbe de relier deux jours pleins par une droite qui n'a
 * pas eu lieu. Le tableau ne montre en revanche que les jours NON NULS — trente
 * lignes a zero ne se lisent pas, et la courbe dit deja qu'il ne s'est rien
 * passe.
 */
function CourbeJournaliere({
  titre,
  note,
  unite,
  colonneValeur,
  serie,
}: {
  titre: string;
  note: string;
  unite: string;
  colonneValeur: string;
  serie: PointSerie[];
}) {
  const total = serie.reduce((s, p) => s + p.valeur, 0);
  const sommet = serie.reduce<PointSerie | null>(
    (m, p) => (m === null || p.valeur > m.valeur ? p : m),
    null,
  );
  const pleins = serie.filter((p) => p.valeur > 0);

  return (
    <Graphique
      titre={titre}
      note={note}
      traceMuet
      resume={
        total === 0
          ? `Aucune ${unite === "commandes" ? "commande" : "vue"} sur les ${serie.length} jours de la période.`
          : `${nombre(total)} ${unite} sur ${serie.length} jours. Maximum ${nombre(sommet?.valeur ?? 0)} le ${jourCourt(sommet?.jour ?? "")}.`
      }
      colonnes={["Jour", colonneValeur]}
      libelleTableau={
        pleins.length === 0 ? "Voir les chiffres" : `Voir les ${nombre(pleins.length)} jours actifs`
      }
      lignes={pleins.map((p) => ({
        cle: p.jour,
        entete: jourCourt(p.jour),
        cellules: [nombre(p.valeur)],
      }))}
    >
      <Courbe points={serie} />
      <p className="mt-1 text-caption text-ink-2">
        {total === 0
          ? `Aucune ${unite === "commandes" ? "commande" : "vue"} sur la période.`
          : `${nombre(total)} au total, maximum ${nombre(sommet?.valeur ?? 0)} le ${jourCourt(sommet?.jour ?? "")}.`}
      </p>
    </Graphique>
  );
}

/* ══════════════════ 5. les articles les plus vus ══════════════════ */

/**
 * Des categories NOMINALES : des noms d'articles, sans ordre naturel. Toutes les
 * barres prennent donc la meme teinte. Les colorer par leur valeur redirait en
 * couleur ce que la longueur dit deja, en depensant le seul canal libre.
 */
function ArticlesLesPlusVus({ stats, periode }: { stats: StatsVendeuse; periode: string }) {
  const articles = stats.articlesLesPlusVus;

  return (
    <Card>
      <Graphique
        titre="Vos articles les plus vus"
        note={`${periode} Les cinq premiers.`}
        resume={
          articles.length === 0
            ? "Aucun article vu sur la période."
            : articles.map((a) => `${a.nom} : ${nombre(a.vues)} vues`).join(", ")
        }
        colonnes={["Article", "Vues"]}
        lignes={articles.map((a) => ({ cle: a.id, entete: a.nom, cellules: [nombre(a.vues)] }))}
      >
        {articles.length === 0 ? (
          <EmptyState title="Aucun article vu">
            Ce classement se remplira quand les vues de votre boutique seront comptées.
          </EmptyState>
        ) : (
          <Barres
            items={articles.map((a) => ({ cle: a.id, libelle: a.nom, valeur: a.vues }))}
            unite="vues"
          />
        )}
      </Graphique>
    </Card>
  );
}

/* ══════════════════ 6. ce qu'on ne mesure pas ══════════════════ */

/**
 * Les sources de trafic n'existent pas, et l'ecran le DIT au lieu de laisser un
 * trou.
 *
 * Rien dans le systeme n'enregistre d'ou vient une visite : ni referent, ni
 * parametre de campagne, ni table pour les recevoir. On pourrait dessiner un
 * graphique plausible ; ce serait combler une information manquante par une
 * valeur inventee, ce qu'AGENTS.md §7.7 interdit — et une vendeuse arbitrerait
 * son budget dessus. Voir l'ADR 0022.
 */
function SourcesDeTrafic() {
  return (
    <Card>
      <CardTitle>D'où viennent vos clientes</CardTitle>
      <CardNote data-testid="sources-de-trafic-absentes">
        Nous ne le mesurons pas encore. Rien n'enregistre aujourd'hui si une cliente arrive par
        WhatsApp, par un lien partagé ou par une recherche — et nous préférons vous le dire plutôt
        que d'afficher un graphique inventé.
      </CardNote>
    </Card>
  );
}

/* ══════════════════ l'ecran sans boutique ══════════════════ */

function SansBoutique() {
  return (
    <Ecran titre="Vos chiffres" surtitre="Statistiques">
      <EmptyState title="Votre boutique n'est pas encore ouverte">
        Les chiffres arrivent avec la première commande. Ouvrez d'abord votre boutique.
      </EmptyState>
      <Button render={<Link to="/" />} tone="primary" size="lg">
        Ouvrir ma boutique
      </Button>
    </Ecran>
  );
}
