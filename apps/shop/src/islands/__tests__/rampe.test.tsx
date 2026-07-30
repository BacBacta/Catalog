import type { CanalUssd, OperateurRampe } from "@catalog/contracts/ussd";
import { render } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { lireParametres } from "../Payer.tsx";
import { Attente } from "../rampe/Attente.tsx";
import { ChoixOperateur } from "../rampe/ChoixOperateur.tsx";
import { Rampe } from "../rampe/Rampe.tsx";

/**
 * Les ecrans de la rampe, rendus.
 *
 * Deux criteres de la definition de terminé du lot 9 se jouent ici :
 *
 * 1. **une entree `verifie: false` affiche LES DEUX chemins** — le raccourci et
 *    le code d'entree, avec les etapes ecrites au-dessous ;
 * 2. **l'ecran d'attente n'annonce jamais un paiement confirme.**
 *
 * Les gabarits utilises sont ceux des tests : ces composants ne connaissent
 * aucun code, ils affichent ce que la configuration leur donne.
 */

const canal = (p: Partial<CanalUssd>): CanalUssd => ({
  id: "c",
  libelle: "essai",
  modele: "*000#",
  verifie: false,
  ...p,
});

const operateur = (p: Partial<OperateurRampe> = {}): OperateurRampe => ({
  id: "essai",
  nom: "Portefeuille d'essai",
  codeEntree: canal({ id: "entree", libelle: "Ouvrir le menu", modele: "*000#", verifie: true }),
  raccourcis: [
    canal({
      id: "court",
      libelle: "Raccourci : transfert",
      modele: "*000*1*1*{numero}*{montant}#",
      verifie: false,
    }),
  ],
  etapes: [
    "Touchez Composer.",
    "Appuyez sur appeler.",
    "Confirmez avec votre code secret — il se tape chez l'operateur, jamais ici.",
  ],
  etapesAConfirmer: true,
  montantMinXaf: 5,
  ...p,
});

const VERSEMENT = { numero: "677123456", montantXaf: 7500 };
const rendre = (n: unknown) => render(n as never);

describe("un raccourci non verifie affiche LES DEUX chemins", () => {
  const html = rendre(<Rampe operateur={operateur()} versement={VERSEMENT} onCompose={() => {}} />);

  it("propose le raccourci", () => {
    expect(html).toContain('data-testid="chemin-raccourci"');
    expect(html).toContain("*000*1*1*677123456*7500#");
  });

  it("propose AUSSI le code d'entree, avec son propre bouton", () => {
    // C'est le chemin qui ne peut pas echouer : il ne disparait jamais.
    expect(html).toContain('data-testid="chemin-code_entree"');
    expect(html).toContain('data-testid="composer-code_entree"');
  });

  it("dit que le raccourci n'a pas ete essaye, et ou aller s'il echoue", () => {
    expect(html).toContain('data-testid="raccourci-a-confirmer"');
    expect(html).toMatch(/n&#039;a pas encore ete essaye|n'a pas encore ete essaye/);
  });

  it("ecrit les etapes AU-DESSOUS, toujours", () => {
    expect(html).toContain("Comment ca se passe");
    expect(html).toContain("Touchez Composer.");
    // Le bouton d'abord, les etapes ensuite : une acheteuse qui a lu ce qui va
    // se passer ne s'arrete pas au premier menu inattendu.
    expect(html.indexOf('data-testid="composer-raccourci"')).toBeLessThan(
      html.indexOf("Comment ca se passe"),
    );
  });

  it("encode le diese dans les deux liens tel:", () => {
    expect(html).toContain("tel:*000*1*1*677123456*7500%23");
    expect(html).toContain("tel:*000%23");
    // Aucun href tel: ne porte de diese brut : il serait pris pour une ancre.
    expect(html).not.toMatch(/href="tel:[^"]*#/);
  });

  it("marque les etapes comme a confirmer tant que les menus ne sont pas releves", () => {
    expect(html).toContain('data-testid="etapes-a-confirmer"');
  });
});

describe("un raccourci verifie ne fait pas disparaitre le chemin manuel", () => {
  const html = rendre(
    <Rampe
      operateur={operateur({
        raccourcis: [canal({ id: "court", modele: "*000*1*{numero}*{montant}#", verifie: true })],
        etapesAConfirmer: false,
      })}
      versement={VERSEMENT}
      onCompose={() => {}}
    />,
  );

  it("garde les deux chemins et les etapes", () => {
    expect(html).toContain('data-testid="chemin-raccourci"');
    expect(html).toContain('data-testid="chemin-code_entree"');
    expect(html).toContain("Comment ca se passe");
  });

  it("ne porte plus l'avertissement de non-verification", () => {
    expect(html).not.toContain('data-testid="raccourci-a-confirmer"');
    expect(html).not.toContain('data-testid="etapes-a-confirmer"');
  });
});

describe("montant sous le minimum de l'operateur", () => {
  it("le dit avant de composer, plutot que de laisser l'operateur refuser", () => {
    // Mesure le 29/07/2026 : Orange rend ER201 sous 10 F. Une session pour rien.
    const html = rendre(
      <Rampe
        operateur={operateur({ montantMinXaf: 10 })}
        versement={{ numero: "677123456", montantXaf: 5 }}
        onCompose={() => {}}
      />,
    );
    expect(html).toMatch(/refuse les montants sous/);
    expect(html).not.toContain("tel:");
  });
});

describe("aucun champ de code secret, nulle part", () => {
  const ecrans = [
    rendre(<Rampe operateur={operateur()} versement={VERSEMENT} onCompose={() => {}} />),
    rendre(<ChoixOperateur operateurs={[operateur()]} onChoisir={() => {}} />),
    rendre(<Attente numero="677123456" montantXaf={7500} whatsapp="677000001" />),
  ];

  it("ne rend aucun champ de saisie", () => {
    // Catalog n'a AUCUN champ ou un code secret pourrait etre saisi. Le plus sur
    // est qu'il n'y ait aucun champ du tout sur ce parcours.
    for (const html of ecrans) expect(html).not.toMatch(/<input/i);
  });

  it("ne parle du code secret que pour dire qu'il ne se tape pas ici", () => {
    const rampe = ecrans[0] as string;
    expect(rampe).toMatch(/code secret/i);
    expect(rampe).toMatch(/ne se tape jamais sur Catalog/i);
  });
});

describe("ecran d'attente", () => {
  const html = rendre(
    <Attente numero="677123456" montantXaf={7500} whatsapp="677000001" reference="CT-1043" />,
  );

  it("dit qui confirmera, et ne confirme rien lui-meme", () => {
    expect(html).toContain("La vendeuse confirmera la reception");
  });

  it("n'annonce NI succes NI echec", () => {
    // Catalog n'a pas de fenetre sur l'operateur : il ne sait pas. Afficher
    // « paiement confirme » serait exactement le mensonge que le produit existe
    // pour remplacer.
    for (const interdit of [
      /paiement\s+confirm/i,
      /paiement\s+re[cç]u/i,
      /paiement\s+valid/i,
      /paiement\s+r[ée]ussi/i,
      /paiement\s+[ée]chou/i,
      /transaction\s+r[ée]ussie/i,
      /\bpay[ée]\s*!?\s*<\/h/i,
    ]) {
      expect(html, String(interdit)).not.toMatch(interdit);
    }
  });

  it("rappelle que la preuve est le SMS de l'operateur, pas une capture", () => {
    expect(html).toMatch(/capture d&#039;ecran|capture d'ecran/);
    expect(html).toMatch(/SMS/);
  });

  it("porte le numero et le montant en clair", () => {
    expect(html).toContain("6 77 12 34 56");
    expect(html).toMatch(/7(\s|&#x202F;|&#8239;| )500/);
  });

  it("propose de prevenir la vendeuse, avec les deux faits dans le message", () => {
    expect(html).toContain('data-testid="prevenir-vendeuse"');
    const lien = /href="(https:\/\/wa\.me\/[^"]+)"/.exec(html)?.[1] ?? "";
    const texte = decodeURIComponent(lien.replace(/&amp;/g, "&").split("?text=")[1] ?? "");
    expect(texte).toContain("6 77 12 34 56");
    expect(texte).toContain("CT-1043");
  });

  it("reste lisible quand le numero de la vendeuse est inconnu", () => {
    const sansLien = rendre(<Attente numero="677123456" montantXaf={7500} />);
    expect(sansLien).not.toContain("wa.me");
    expect(sansLien).toContain("Prevenez la vendeuse");
  });
});

describe("choix de l'operateur", () => {
  it("liste les operateurs de la configuration, pas une liste ecrite en dur", () => {
    const html = rendre(
      <ChoixOperateur
        operateurs={[
          operateur({ id: "a", nom: "Portefeuille A" }),
          operateur({ id: "b", nom: "Portefeuille B" }),
        ]}
        onChoisir={() => {}}
      />,
    );
    expect(html).toContain("Portefeuille A");
    expect(html).toContain("Portefeuille B");
    expect(html).toContain('data-testid="operateur-a"');
  });

  it("reste utilisable quand la configuration est vide", () => {
    const html = rendre(<ChoixOperateur operateurs={[]} onChoisir={() => {}} />);
    expect(html).toMatch(/Reglez directement avec la vendeuse/);
  });
});

describe("lecture des parametres de l'URL", () => {
  it("lit le numero, le montant et le reste", () => {
    const p = lireParametres("?numero=677123456&montant=7500&boutique=Chez%20Ela&ref=CT-1043");
    expect(p).toEqual({
      numero: "677123456",
      montantXaf: 7500,
      boutique: "Chez Ela",
      whatsapp: undefined,
      reference: "CT-1043",
    });
  });

  it("refuse un montant qui n'est pas un entier de francs", () => {
    // Le franc CFA n'a pas de sous-unite, et une chaine USSD portant une virgule
    // ne compose rien.
    for (const m of ["7500.5", "7 500", "-100", "0", "beaucoup", ""]) {
      expect(lireParametres(`?numero=677123456&montant=${encodeURIComponent(m)}`), m).toBeNull();
    }
  });

  it("refuse un lien sans numero", () => {
    expect(lireParametres("?montant=7500")).toBeNull();
  });
});
