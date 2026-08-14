import { formatOctets, formatXaf } from "@catalog/contracts";
import {
  Button,
  Card,
  CardNote,
  CardTitle,
  Field,
  Input,
  LoadingState,
  OfflineState,
} from "@catalog/ui";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Ecran } from "../components/Ecran.tsx";
import { Protege } from "../components/Protege.tsx";
import { type Article, api, messageDErreur, PanneReseau } from "../lib/api.ts";
import {
  MESSAGE_REFUS_PHOTO,
  type PhotoPreparee,
  PhotoRefusee,
  preparerPhoto,
} from "../lib/image.ts";

/**
 * Creation et modification d'un article.
 *
 * **Trois champs, et pas un de plus : photo, nom, prix.** Chaque champ
 * supplementaire est une vendeuse perdue — elle remplit ce formulaire debout,
 * entre deux clientes.
 *
 * Le gain de poids de la photo est **affiche**. Ce n'est pas un gadget de
 * developpeur : c'est son forfait data, et le voir la rassure sur le fait
 * qu'envoyer une photo ne va pas lui couter sa journee.
 *
 * La description (ADR 0033) et le stock (ADR 0038) ne contredisent pas la regle
 * des trois champs : ils sont FACULTATIFS et REPLIES derriere un disclosure.
 * Ils n'ajoutent rien au chemin oblige.
 *
 * Le stock etait jusqu'a la tranche P1d une colonne LUE PARTOUT et ECRITE NULLE
 * PART : le bot bornait les quantites dessus, la boutique publique affichait
 * « il n'en reste que N », et aucune interface ne permettait d'y toucher. C'est
 * exactement le mensonge d'instrumentation que le lot 13 interdit ailleurs.
 * Ce qu'il vaut est dit en toutes lettres a la vendeuse : un plafond qu'elle
 * tient, pas un inventaire qui se decompte (ADR 0038).
 */
export function ArticleForm() {
  return <Protege>{() => <Formulaire />}</Protege>;
}

function Formulaire() {
  const { id } = useParams();
  const nouveau = id === undefined;
  const naviguer = useNavigate();
  const champPhoto = useRef<HTMLInputElement>(null);
  const idPhoto = useId();

  const [chargement, setChargement] = useState(!nouveau);
  const [article, setArticle] = useState<Article | null>(null);
  const [nom, setNom] = useState("");
  const [prix, setPrix] = useState("");
  const [description, setDescription] = useState("");
  /* Chaine et non nombre : le champ vide doit exister, et il veut dire « je ne
     suis pas mon stock » — ce qui n'est pas zero. */
  const [stock, setStock] = useState("");
  const [photo, setPhoto] = useState<PhotoPreparee | null>(null);
  const [apercu, setApercu] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [horsLigne, setHorsLigne] = useState(false);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (nouveau) return;
    let vivant = true;
    (async () => {
      const r = await api.articles(true);
      if (!vivant) return;
      const a = r.donnees?.articles.find((x) => x.id === id) ?? null;
      if (a) {
        setArticle(a);
        setNom(a.name);
        setPrix(String(a.priceXaf));
        setDescription(a.description ?? "");
        /* Zero en base = non suivi (ADR 0038) : le champ reste vide, sinon la
           vendeuse lirait « 0 » et croirait sa boutique en rupture. */
        setStock(a.stock > 0 ? String(a.stock) : "");
      } else {
        setErreur("Cet article n'existe plus.");
      }
      setChargement(false);
    })().catch(() => {
      if (vivant) {
        setHorsLigne(true);
        setChargement(false);
      }
    });
    return () => {
      vivant = false;
    };
  }, [id, nouveau]);

  // L'URL d'apercu est revoquee quand elle change : sans cela, chaque photo
  // choisie retient sa memoire jusqu'a la fermeture de l'onglet.
  useEffect(() => {
    if (!photo) return;
    const url = URL.createObjectURL(photo.fichier);
    setApercu(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  async function choisirPhoto(fichier: File | undefined) {
    if (!fichier) return;
    setErreur(null);
    try {
      setPhoto(await preparerPhoto(fichier));
    } catch (cause) {
      setPhoto(null);
      setErreur(
        cause instanceof PhotoRefusee
          ? MESSAGE_REFUS_PHOTO[cause.raison]
          : "Cette photo n'a pas pu etre preparee.",
      );
    }
  }

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur(null);

    const priceXaf = Number(prix.replace(/[^\d]/g, ""));
    if (!nom.trim() || !Number.isInteger(priceXaf) || priceXaf <= 0) {
      setErreur("Il faut un nom et un prix en francs entiers.");
      return;
    }

    setEnCours(true);
    try {
      let cible = article;
      const desc = description.trim();
      /* Vide → 0, c'est-a-dire « non suivi ». Le champ n'accepte que des
         chiffres, donc `Number` ne rend jamais NaN ici. */
      const quantite = stock.trim() === "" ? 0 : Number(stock.replace(/\D/g, ""));
      if (!cible) {
        const r = await api.creerArticle(nom.trim(), priceXaf, desc || undefined, quantite);
        if (!r.ok || !r.donnees) {
          setErreur(messageDErreur(r, "L'article n'a pas pu etre cree."));
          return;
        }
        cible = r.donnees;
      } else if (
        cible.name !== nom.trim() ||
        cible.priceXaf !== priceXaf ||
        (cible.description ?? "") !== desc ||
        cible.stock !== quantite
      ) {
        const r = await api.modifierArticle(cible.id, {
          name: nom.trim(),
          priceXaf,
          description: desc,
          stock: quantite,
        });
        if (!r.ok || !r.donnees) {
          setErreur(messageDErreur(r, "La modification n'a pas abouti."));
          return;
        }
        cible = r.donnees;
      }

      if (photo) {
        const r = await api.envoyerPhoto(cible.id, photo.fichier);
        if (!r.ok) {
          // L'article existe deja : on le dit, plutot que de laisser croire que
          // rien n'a ete enregistre.
          setArticle(cible);
          setErreur(
            messageDErreur(r, "La photo n'a pas pu etre envoyee. L'article est enregistre."),
          );
          return;
        }
      }

      naviguer("/articles", { replace: true });
    } catch (cause) {
      if (cause instanceof PanneReseau) setHorsLigne(true);
      else setErreur("L'enregistrement n'a pas abouti.");
    } finally {
      setEnCours(false);
    }
  }

  const titre = nouveau ? "Nouvel article" : "Modifier l'article";

  if (horsLigne) {
    return (
      <Ecran titre={titre} surtitre="Catalogue">
        <OfflineState
          action={
            <Button tone="outline" onClick={() => setHorsLigne(false)}>
              Reessayer
            </Button>
          }
        >
          Rien n'a ete perdu. Ce que vous avez tape est toujours a l'ecran, et repartira des que le
          reseau revient.
        </OfflineState>
      </Ecran>
    );
  }

  if (chargement) {
    return (
      <Ecran titre={titre} surtitre="Catalogue">
        <LoadingState label="Lecture de l'article…" />
      </Ecran>
    );
  }

  const dejaEnLigne = article?.image ?? null;

  return (
    <Ecran
      titre={titre}
      surtitre="Catalogue"
      retour={{ vers: "/articles", libelle: "Mes articles" }}
    >
      <Card>
        <CardTitle>Photo, nom, prix</CardTitle>
        <CardNote>C'est tout. Rien d'autre n'est obligatoire.</CardNote>

        <form onSubmit={soumettre} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor={idPhoto} className="block text-caption font-semibold text-ink-2">
              Photo
            </label>
            <input
              id={idPhoto}
              ref={champPhoto}
              type="file"
              // `accept` filtre le selecteur ; `capture` propose l'appareil photo
              // en premier, ce qui est le geste reel : la vendeuse photographie
              // l'article qu'elle a en main.
              accept="image/jpeg,image/png,image/webp,image/avif"
              capture="environment"
              onChange={(e) => void choisirPhoto(e.target.files?.[0])}
              className="min-h-[var(--size-touch)] w-full rounded-field border border-control-line bg-surface p-2 text-body text-ink"
            />

            {apercu ? (
              <img
                src={apercu}
                alt="Apercu de l'article tel qu'il sera vu"
                width={photo?.largeur ?? 160}
                height={photo?.hauteur ?? 160}
                className="max-h-48 w-auto rounded-field object-contain"
              />
            ) : dejaEnLigne ? (
              <picture>
                <source srcSet={dejaEnLigne.avif} type="image/avif" />
                <img
                  src={dejaEnLigne.webp}
                  alt="L'article tel qu'il est en ligne"
                  width={dejaEnLigne.largeur ?? 160}
                  height={dejaEnLigne.hauteur ?? 160}
                  className="max-h-48 w-auto rounded-field object-contain"
                />
              </picture>
            ) : null}

            {/* Le gain de poids : c'est son forfait data, pas une statistique. */}
            <p data-testid="gain-photo" role="status" aria-live="polite" className="text-caption">
              {photo
                ? photo.brut
                  ? `Photo de ${formatOctets(photo.octetsAvant)}. Votre telephone n'a pas pu la reduire ici — l'envoi sera plus long, mais elle sera reduite a l'arrivee.`
                  : `${formatOctets(photo.octetsAvant)} → ${formatOctets(photo.octetsApres)} avant l'envoi. C'est autant de forfait economise.`
                : ""}
            </p>
          </div>

          <Field
            label="Nom de l'article"
            htmlFor="nom-article"
            hint="Comme vous le dites a vos client/es."
          >
            <Input
              id="nom-article"
              name="nom"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              aria-describedby="nom-article-hint"
            />
          </Field>

          <Field
            label="Prix en francs"
            htmlFor="prix-article"
            hint={
              Number(prix.replace(/[^\d]/g, "")) > 0
                ? `Soit ${formatXaf(Number(prix.replace(/[^\d]/g, "")))}.`
                : "Un nombre entier de francs. Pas de virgule."
            }
          >
            <Input
              id="prix-article"
              name="prix"
              type="text"
              inputMode="numeric"
              value={prix}
              onChange={(e) => setPrix(e.target.value.replace(/[^\d\s]/g, ""))}
              aria-describedby="prix-article-hint"
              placeholder="15000"
            />
          </Field>

          {/* Facultatifs et replies : le chemin oblige reste photo, nom, prix. */}
          <details open={description.trim().length > 0 || stock.trim() !== ""}>
            <summary className="min-h-[var(--size-touch)] cursor-pointer py-2 text-caption font-semibold text-ink-2">
              Description et stock (facultatif)
            </summary>
            <div className="flex flex-col gap-4">
              <Field
                label="Description"
                htmlFor="description-article"
                hint={`Matiere, dimensions, usage — elle se lit sur la fiche WhatsApp. ${description.trim().length}/300.`}
              >
                <textarea
                  id="description-article"
                  name="description"
                  value={description}
                  maxLength={300}
                  rows={3}
                  onChange={(e) => setDescription(e.target.value)}
                  aria-describedby="description-article-hint"
                  className="w-full rounded-field border border-control-line bg-surface p-3 text-body text-ink"
                />
              </Field>

              {/* Ce que le nombre VEUT DIRE est ecrit ici, parce qu'il ne se
                  devine pas : il ne se decompte pas tout seul (ADR 0038). */}
              <Field
                label="Combien vous en avez"
                htmlFor="stock-article"
                hint={
                  stock.trim() === ""
                    ? "Laissez vide si vous ne comptez pas. Sinon, personne ne pourra en commander plus que ce nombre — a vous de le corriger quand vous vendez."
                    : `Personne ne pourra en commander plus de ${Number(stock.replace(/\D/g, ""))} d'un coup. Ce nombre ne baisse pas tout seul : corrigez-le quand vous vendez.`
                }
              >
                <Input
                  id="stock-article"
                  name="stock"
                  type="text"
                  inputMode="numeric"
                  value={stock}
                  onChange={(e) => setStock(e.target.value.replace(/\D/g, ""))}
                  aria-describedby="stock-article-hint"
                  placeholder="vide = je ne compte pas"
                />
              </Field>
            </div>
          </details>

          <p role="status" aria-live="polite" className="text-caption text-danger">
            {erreur}
          </p>

          <Button type="submit" size="lg" loading={enCours}>
            {enCours ? "Enregistrement…" : nouveau ? "Publier l'article" : "Enregistrer"}
          </Button>
        </form>
      </Card>
    </Ecran>
  );
}
