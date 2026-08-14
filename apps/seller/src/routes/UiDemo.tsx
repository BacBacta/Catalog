import {
  Badge,
  Button,
  Card,
  CardNote,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  MoneyDisplay,
  OfflineState,
  type ProofCheckItem,
  ProofChecklist,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTrigger,
  Skeleton,
  SmsPasteField,
  StatTile,
  StatusBadge,
  Tab,
  TabPanel,
  Tabs,
  TabsList,
  ToastHost,
  toastManager,
} from "@catalog/ui";
import { useEffect, useState } from "react";

/**
 * Page de demonstration du design system — le livrable verifiable du lot 2.
 *
 * Elle sert trois choses :
 *  - montrer chaque composant dans ses QUATRE etats : chargement, vide,
 *    erreur, hors ligne ;
 *  - laisser basculer le theme a la main, pour prouver que la preference
 *    explicite l'emporte dans les deux sens sur `prefers-color-scheme` ;
 *  - servir de cible a axe-core et a la mesure de poids JS.
 *
 * Aucun texte ici n'est du contenu produit : les libelles metier arrivent avec
 * leurs lots. Ce qui est montre, c'est le socle.
 */

type Theme = "system" | "light" | "dark";

function useTheme() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);
  return { theme, setTheme };
}

/** Les sept controles, dans leurs quatre etats. Le lot 8 fournira les vrais. */
const CHECKS: ProofCheckItem[] = [
  {
    id: "c1",
    title: "Format opérateur reconnu",
    explanation: "Le message a bien la forme d’un SMS MTN Mobile Money.",
    state: "pass",
  },
  {
    id: "c2",
    title: "Montant conforme",
    explanation: "Le SMS annonce 16 500 FCFA, la commande en attend 17 000. Il manque 500 FCFA.",
    state: "fail",
  },
  {
    id: "c3",
    title: "Contrepartie",
    explanation:
      "Le numéro qui a payé n’est pas celui enregistré. Ce n’est pas bloquant : beaucoup de gens paient depuis le téléphone d’un proche.",
    state: "warn",
  },
  {
    id: "c4",
    title: "Horodatage cohérent",
    explanation: "Le paiement est daté d’après la commande, et de moins de 48 h.",
    state: "pass",
  },
  {
    id: "c5",
    title: "Identifiant jamais réclamé ailleurs",
    explanation: "Cet identifiant de transaction n’a été utilisé chez aucun/e autre vendeur/se.",
    state: "pass",
  },
  {
    id: "c6",
    title: "Identifiant cohérent avec sa date",
    explanation: "Ce contrôle ne s’applique qu’aux paiements Orange Money.",
    state: "pending",
  },
  {
    id: "c7",
    title: "Contre-signature de l’acheteur/se",
    explanation: "Pas encore confirmé depuis le lien de suivi.",
    state: "pending",
  },
];

const OPERATEURS = [
  { value: "mtn", label: "MTN Mobile Money" },
  { value: "orange", label: "Orange Money" },
];

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-title font-bold text-ink">{title}</h2>
        {note ? <p className="text-caption text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function UiDemo() {
  const { theme, setTheme } = useTheme();
  const [sms, setSms] = useState("");

  return (
    <ToastHost>
      <main className="mx-auto flex max-w-2xl flex-col gap-9 px-5 py-8 font-sans text-ink">
        <header className="flex flex-col gap-3">
          <p className="text-caption font-semibold uppercase tracking-[0.08em] text-muted">
            Catalog · design system
          </p>
          <h1 className="text-hero font-extrabold leading-tight">Composants</h1>
          <p className="text-body text-ink-2">
            « Premium » veut dire ici rapide, lisible en plein soleil et clair sur les montants. Pas
            riche en animations.
          </p>

          <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
            <legend className="pb-1 text-caption font-semibold text-ink-2">Thème</legend>
            {(["system", "light", "dark"] as const).map((t) => (
              <Button
                key={t}
                tone={theme === t ? "primary" : "outline"}
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {t === "system" ? "Système" : t === "light" ? "Clair" : "Sombre"}
              </Button>
            ))}
          </fieldset>
          <CardNote>
            Le choix explicite gagne contre la préférence du système, dans les deux sens.
          </CardNote>
        </header>

        <Separator />

        <Section
          title="Montants"
          note="Entiers XAF, espace fine insécable. Tabulaires en colonne, proportionnels en grand."
        >
          <Card>
            <MoneyDisplay amountXaf={12250} size="hero" />
            <div className="flex flex-col gap-1">
              {[17000, 3750, 250].map((v) => (
                <div key={v} className="flex justify-between">
                  <span className="text-body text-ink-2">Commande CT-10{v % 100}</span>
                  <MoneyDisplay amountXaf={v} tabular />
                </div>
              ))}
            </div>
            <CardNote>
              Les trois montants ci-dessus sont alignés : c’est ce que font les chiffres tabulaires.
            </CardNote>
          </Card>
        </Section>

        <Section title="Pastilles de statut" note="La couleur ne porte jamais l’information seule.">
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="good" label="Prouvé" />
            <StatusBadge tone="brand" label="Contresigné" />
            <StatusBadge tone="warn" label="Non tracé" />
            <StatusBadge tone="danger" label="Contesté" />
            <StatusBadge tone="neutral" label="Attendu" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">Neutre</Badge>
            <Badge tone="brand">Marque</Badge>
            <Badge tone="good">Bon</Badge>
            <Badge tone="warn">Avertissement</Badge>
            <Badge tone="danger">Danger</Badge>
          </div>
        </Section>

        <Section title="Tuiles" note="Chiffre, libellé, et l’état de chargement du même bloc.">
          <div className="grid gap-3 sm:grid-cols-2">
            <StatTile
              label="Soldes à encaisser"
              value={<MoneyDisplay amountXaf={12250} size="hero" />}
              note="3 commandes en acompte"
            />
            <StatTile label="Ventes prouvées" value="—" loading />
          </div>
        </Section>

        <Section title="Boutons" note="Toutes les cibles font au moins 44 px.">
          <div className="flex flex-wrap gap-2">
            <Button>Principal</Button>
            <Button tone="outline">Contour</Button>
            <Button tone="ghost">Discret</Button>
            <Button tone="danger">Danger</Button>
            <Button disabled>Désactivé</Button>
          </div>
          <Button
            tone="primary"
            size="lg"
            onClick={() =>
              toastManager.add({
                title: "Preuve enregistrée",
                description: "Le reçu est prêt à être partagé.",
              })
            }
          >
            Afficher un avis passager
          </Button>
        </Section>

        <Section title="Champs">
          <Card>
            <Field
              label="Nom de la boutique"
              htmlFor="shop"
              hint="C’est ce que voient vos client/es."
            >
              <Input id="shop" defaultValue="Chez Maman Jeanne" />
            </Field>
            <Field label="Numéro de reversement" htmlFor="msisdn" hint="Format 6XX XX XX XX.">
              <Input id="msisdn" inputMode="numeric" placeholder="677 12 34 56" />
            </Field>
            <Field label="Opérateur" htmlFor="op">
              {/* `items` permet a Select.Value d'afficher le LIBELLE et non la
                  valeur brute : sans lui le champ montre « mtn ». */}
              <Select defaultValue="mtn" items={OPERATEURS}>
                <SelectTrigger id="op">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATEURS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Card>
        </Section>

        <Section
          title="Coller le SMS de l’opérateur"
          note="Le champ dont l’usage entier est le collage. Il n’est jamais bloqué."
        >
          <Card>
            <SmsPasteField
              value={sms}
              onValueChange={setSms}
              notice={
                <p className="rounded-field bg-warn-soft p-3 text-caption text-warn">
                  Ne vous fiez jamais à une capture d’écran. Seul votre propre SMS compte.
                </p>
              }
            />
          </Card>
        </Section>

        <Section
          title="Les sept contrôles"
          note="Chaque ligne dit pourquoi, en langue simple. Sans le pourquoi, le/la vendeur/se expédie quand même."
        >
          <ProofChecklist items={CHECKS} />
        </Section>

        <Section title="Onglets">
          <Tabs defaultValue="a">
            <TabsList>
              <Tab value="a">Commandes</Tab>
              <Tab value="b">Articles</Tab>
            </TabsList>
            <TabPanel value="a">Trois commandes en attente de preuve.</TabPanel>
            <TabPanel value="b">Dix-huit articles publiés.</TabPanel>
          </Tabs>
        </Section>

        <Section title="Superpositions" note="Comportement et focus fournis par Base UI.">
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger render={<Button tone="outline">Boîte de dialogue</Button>} />
              <DialogContent
                title="Confirmer l’envoi"
                description="La commande passera en « confiée au livreur »."
              >
                <div className="flex gap-2">
                  <DialogClose render={<Button tone="outline">Annuler</Button>} />
                  <DialogClose render={<Button>Confirmer</Button>} />
                </div>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger render={<Button tone="outline">Panneau glissant</Button>} />
              <SheetContent title="Détail de la commande">
                <p className="text-body text-ink-2">
                  Le panneau arrive par le bas : c’est là que se trouve le pouce.
                </p>
                <SheetClose render={<Button size="lg">Fermer</Button>} />
              </SheetContent>
            </Sheet>
          </div>
        </Section>

        <Section
          title="Les quatre états de chaque écran"
          note="Le hors ligne n’est pas un cas rare : il est aussi fréquent que le mode connecté."
        >
          <Card>
            <CardTitle>Chargement</CardTitle>
            <LoadingState />
          </Card>
          <Card>
            <CardTitle>Vide</CardTitle>
            <EmptyState>
              Vous n’avez pas encore d’article. Ajoutez-en un avec une photo, un nom et un prix.
            </EmptyState>
          </Card>
          <Card>
            <CardTitle>Erreur</CardTitle>
            <ErrorState action={<Button tone="outline">Réessayer</Button>}>
              Nous n’avons pas pu charger vos commandes.
            </ErrorState>
          </Card>
          <Card>
            <CardTitle>Hors ligne</CardTitle>
            <OfflineState />
          </Card>
        </Section>

        <Section title="Squelettes">
          <Card>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
            <CardNote>La pulsation disparaît sous « animations réduites ».</CardNote>
          </Card>
        </Section>
      </main>
    </ToastHost>
  );
}
