import type { RecuJson } from "@catalog/contracts/recu";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { codeDuChemin } from "../Recu.tsx";
import { CarteRecu, CarteRefus } from "../recu/CarteRecu.tsx";
import { jetonDuChemin } from "../Suivi.tsx";

/**
 * Le recu, rendu.
 *
 * Ce qui se joue ici : **un recu ne ressemble jamais a un certificat**. Pas de
 * « garanti », pas de « certifie ». Et un refus est EXPLICITE : une page vide
 * laisserait croire a une panne la ou il faut une decision.
 */

const recu = (p: Partial<RecuJson> = {}): RecuJson => ({
  reference: "CT-1043",
  code: "ACDE-4679",
  boutique: "Chez Maman Jeanne",
  operateur: { cle: "mtn", nom: "MTN Mobile Money" },
  operatorTxId: "17600000002",
  montantXaf: 26800,
  totalXaf: 26800,
  resteXaf: 0,
  survenuA: "2026-06-23T08:50:32.000Z",
  constateA: "2026-06-23T08:52:00.000Z",
  contresigneA: null,
  etat: "prouve",
  aConfirmer: false,
  marcheAsuivre: {
    codeOperateur: "*000#",
    codeVerifie: true,
    etapes: ["Composez le code ci-dessus.", "Demandez l'historique."],
    etapesAConfirmer: true,
  },
  ...p,
});

const PORTEE =
  "Ce reçu n'est pas une preuve informatique : c'est un identifiant de transaction que " +
  "l'opérateur peut confirmer.";

const rendre = (n: unknown) => render(n as never);

describe("la carte de recu", () => {
  const html = rendre(<CarteRecu recu={recu()} portee={PORTEE} />);

  it("met l'identifiant de transaction en avant", () => {
    // C'est LUI qui se controle. Le montant seul ne prouve rien.
    expect(html).toContain('data-testid="identifiant"');
    expect(html).toContain("17600000002");
  });

  it("porte le montant, la reference et la boutique", () => {
    expect(html).toContain("CT-1043");
    expect(html).toContain("Chez Maman Jeanne");
    expect(html).toMatch(/26(\s|&#x202F;|&#8239;| )800/);
  });

  it("distingue la date du transfert de celle du constat", () => {
    // Les confondre laisserait croire que Catalog a vu passer le transfert.
    expect(html).toContain("Date du transfert");
    expect(html).toContain("Constaté par Catalog");
  });

  it("n'ecrit JAMAIS « garanti » ni « certifie »", () => {
    for (const variante of [
      recu(),
      recu({ etat: "contresigne", contresigneA: "2026-06-23T17:00:00.000Z" }),
      recu({ aConfirmer: true }),
      recu({ resteXaf: 13400 }),
    ]) {
      const h = rendre(<CarteRecu recu={variante} portee={PORTEE} />);
      expect(h).not.toMatch(/garanti|certifi|infalsifiable|authentifié par Catalog/i);
    }
  });

  it("affiche la marche a suivre issue de la CONFIGURATION", () => {
    expect(html).toContain('data-testid="code-operateur"');
    expect(html).toContain("*000#");
    // `preact-render-to-string` n'echappe pas l'apostrophe dans un noeud de
    // texte — seulement dans un attribut. On assert donc le texte tel qu'il est.
    expect(html).toContain("Demandez l'historique.");
    expect(html).toMatch(/intitulés exacts des menus peuvent différer/i);
  });

  it("dit qu'un code n'est pas verifie plutot que de le taire", () => {
    const h = rendre(
      <CarteRecu
        recu={recu({ marcheAsuivre: { ...recu().marcheAsuivre, codeVerifie: false } })}
        portee={PORTEE}
      />,
    );
    expect(h).toMatch(/n'a pas été vérifié/);
  });

  it("porte la reserve d'un motif reconstitue", () => {
    const h = rendre(<CarteRecu recu={recu({ aConfirmer: true })} portee={PORTEE} />);
    expect(h).toContain('data-testid="motif-a-confirmer"');
    expect(h).toMatch(/reconstitué/i);
    expect(html).not.toContain('data-testid="motif-a-confirmer"');
  });

  it("dit si l'acheteuse a confirme, et quand", () => {
    expect(html).toMatch(/Pas encore confirmée par l'acheteur\/se/);
    const signe = rendre(
      <CarteRecu
        recu={recu({ etat: "contresigne", contresigneA: "2026-06-23T17:00:00.000Z" })}
        portee={PORTEE}
      />,
    );
    expect(signe).toMatch(/Confirmée le/);
  });

  it("survit a une date absente sans afficher une date fausse", () => {
    // Un identifiant Orange peut s'auto-invalider : pas de date exploitable.
    const h = rendre(<CarteRecu recu={recu({ survenuA: null })} portee={PORTEE} />);
    expect(h).toContain("non datée");
    expect(h).not.toContain("Invalid Date");
    expect(h).not.toContain("1970");
  });

  it("montre le reste du sur un acompte, et le tait quand tout est paye", () => {
    expect(html).not.toContain("Reste à payer");
    expect(rendre(<CarteRecu recu={recu({ resteXaf: 13400 })} portee={PORTEE} />)).toContain(
      "Reste à payer",
    );
  });

  it("affiche la portee telle qu'elle vient du serveur", () => {
    // Une seule formulation dans le depot : trois ecrans l'affichent.
    expect(html).toContain("identifiant de transaction");
  });
});

describe("l'absence de recu est EXPLICITE", () => {
  it("nomme les quatre refus, et n'en laisse aucun en page vide", () => {
    for (const refus of [
      "code_inconnu",
      "declare_non_trace",
      "preuve_absente",
      "conteste",
    ] as const) {
      const h = rendre(<CarteRefus refus={refus} />);
      expect(h, refus).toContain(`data-testid="refus-${refus}"`);
      expect(h.replace(/<[^>]+>/g, "").trim().length, refus).toBeGreaterThan(60);
    }
  });

  it("un code inconnu dit de ne rien expedier", () => {
    // C'est la consigne qui compte : une vendeuse qui ne comprend pas expedie
    // quand meme, et le produit n'aura servi a rien.
    const h = rendre(<CarteRefus refus="code_inconnu" />);
    expect(h).toMatch(/n'expédiez rien/i);
  });

  it("une contestation dit que la preuve n'a PAS ete effacee", () => {
    expect(rendre(<CarteRefus refus="conteste" />)).toMatch(/n'a pas été effacée/i);
  });

  it("un depot declare a la main dit pourquoi il n'y a rien a verifier", () => {
    expect(rendre(<CarteRefus refus="declare_non_trace" />)).toMatch(/aucun SMS d'opérateur/i);
  });
});

describe("lecture de l'URL", () => {
  it("prend le code dans le chemin, quelle que soit sa forme", () => {
    expect(codeDuChemin("/v/ACDE-4679")).toBe("ACDE-4679");
    expect(codeDuChemin("/v/ACDE-4679/")).toBe("ACDE-4679");
    expect(codeDuChemin("/v/acde4679")).toBe("acde4679");
    expect(codeDuChemin("/v/ACDE%2D4679")).toBe("ACDE-4679");
  });

  it("rend null quand il n'y a pas de code", () => {
    expect(codeDuChemin("/v")).toBeNull();
    expect(codeDuChemin("/v/")).toBeNull();
    expect(codeDuChemin("/autre/ACDE-4679")).toBeNull();
  });

  it("prend le jeton du suivi de la meme facon", () => {
    expect(jetonDuChemin("/suivi/abc123")).toBe("abc123");
    expect(jetonDuChemin("/suivi/")).toBeNull();
    expect(jetonDuChemin("/v/abc123")).toBeNull();
  });
});
