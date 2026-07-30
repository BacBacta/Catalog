import { describe, expect, it } from "vitest";
import { lienCommande, lienWhatsApp, messageCommande, totalCommandeXaf } from "../whatsapp.ts";

/**
 * Le message WhatsApp, y compris son encodage.
 *
 * C'est le critere de la definition de terminé du lot 6, et c'est le seul
 * porteur d'information sur lequel on peut compter : certaines acheteuses sont
 * sur un forfait ou les liens externes echouent.
 */

const BOUTIQUE = "Chez Tantine Éla";

/**
 * Espace fine insecable — celle que `formatXaf` insere entre les milliers et
 * devant « FCFA ». Elle est nommee ici parce qu'une espace ordinaire dans un
 * litteral de test ressemble a la bonne et ne l'est pas : l'echec qui en resulte
 * est illisible.
 */
const NBSP = "\u202f";
const f = (s: string) => s.replaceAll(" ", NBSP);

/**
 * Extrait et decode le parametre `text` d'un lien `wa.me`.
 *
 * On n'utilise pas `URL` : ce paquet est compile sans les types de plateforme,
 * et l'y faire entrer pour un test ferait dependre la source de verite des types
 * d'un environnement d'execution.
 */
const texteDuLien = (lien: string) => decodeURIComponent(/\?text=(.*)$/.exec(lien)?.[1] ?? "");

describe("totalCommandeXaf", () => {
  it("additionne en entiers", () => {
    expect(
      totalCommandeXaf([
        { nom: "Pagne", quantite: 2, prixUnitaireXaf: 15000 },
        { nom: "Savon", quantite: 3, prixUnitaireXaf: 1500 },
      ]),
    ).toBe(34500);
  });

  it("REFUSE un prix a virgule plutot que de l'arrondir en silence", () => {
    // Un arrondi silencieux ferait diverger le total du message et celui de la
    // commande : c'est exactement le detail sur lequel une contestation se joue.
    expect(() =>
      totalCommandeXaf([{ nom: "Pagne", quantite: 1, prixUnitaireXaf: 1500.5 }]),
    ).toThrow();
  });

  it("refuse une quantite nulle ou negative", () => {
    for (const quantite of [0, -1]) {
      expect(() => totalCommandeXaf([{ nom: "Pagne", quantite, prixUnitaireXaf: 100 }])).toThrow();
    }
  });
});

describe("messageCommande", () => {
  const message = messageCommande({
    boutique: BOUTIQUE,
    lignes: [
      { nom: "Pagne wax 6 yards", quantite: 2, prixUnitaireXaf: 15000 },
      { nom: "Savon noir", quantite: 3, prixUnitaireXaf: 1500 },
    ],
  });

  it("porte les CINQ informations canoniques, et rien d'autre", () => {
    // article, quantite, prix unitaire, total, nom de la boutique.
    expect(message).toContain("Pagne wax 6 yards");
    expect(message).toContain("2 x");
    expect(message).toContain(f("15 000 FCFA"));
    expect(message).toContain(`Total : ${f("34 500 FCFA")}`);
    expect(message).toContain(BOUTIQUE);
  });

  it("N'INVENTE ni reference ni code de verification", () => {
    // Ils n'existent qu'une fois la commande creee (lot 11). Un code inconnu de
    // la page publique de verification serait exactement la fausse preuve que le
    // produit combat.
    expect(message).not.toMatch(/CT-\d/);
    expect(message).not.toMatch(/\b[A-Z]{4}-[A-Z]{4}\b/);
    expect(message.toLowerCase()).not.toContain("code");
    expect(message.toLowerCase()).not.toContain("reference");
  });

  it("ne contient AUCUN lien : le texte se suffit a lui-meme", () => {
    expect(message).not.toContain("http");
    expect(message).not.toContain("wa.me");
  });

  it("garde quantite et prix unitaire meme pour un seul article", () => {
    const un = messageCommande({
      boutique: BOUTIQUE,
      lignes: [{ nom: "Sac en raphia", quantite: 1, prixUnitaireXaf: 8000 }],
    });
    // Les espaces autour du « x » sont ordinaires ; seul le montant porte
    // l'espace insecable.
    expect(un).toContain(`1 x ${f("8 000 FCFA")}`);
    expect(un).toContain(`Total : ${f("8 000 FCFA")}`);
  });

  it("le total affiche est la somme des lignes affichees", () => {
    // Un lecteur doit pouvoir refaire le calcul de tete depuis le message seul.
    const lignes = message.split("\n").filter((l) => l.startsWith("- "));
    const somme = lignes.reduce((acc, l) => {
      const dernier = l.split("=")[1] as string;
      return acc + Number(dernier.replace(/[^\d]/g, ""));
    }, 0);
    expect(somme).toBe(34500);
  });

  it("refuse une commande vide", () => {
    expect(() => messageCommande({ boutique: BOUTIQUE, lignes: [] })).toThrow();
  });
});

describe("lienWhatsApp", () => {
  it("met le numero en CHIFFRES SEULEMENT — wa.me/+237… ne s'ouvre pas", () => {
    const lien = lienWhatsApp("+237 677 12 34 56", "bonjour");
    expect(lien.startsWith("https://wa.me/237677123456?text=")).toBe(true);
    expect(lien).not.toContain("+");
    expect(lien).not.toContain(" ");
  });

  it("accepte toutes les mises en forme locales du numero", () => {
    const attendu = "https://wa.me/237677123456?text=bonjour";
    for (const saisie of ["677123456", "237677123456", "+237677123456", "6 77 12 34 56"]) {
      expect(lienWhatsApp(saisie, "bonjour"), saisie).toBe(attendu);
    }
  });

  it("encode les sauts de ligne en %0A — c'est ce qui fait tenir la mise en forme", () => {
    expect(lienWhatsApp("677123456", "un\ndeux")).toContain("un%0Adeux");
  });

  it("encode l'espace INSECABLE de formatXaf", () => {
    // `formatXaf` insere une espace fine insecable (U+202F). Non encodee, elle
    // casserait l'URL ; doublement encodee, elle afficherait %E2%80%AF a
    // l'acheteuse.
    const lien = lienWhatsApp("677123456", "15 000 FCFA");
    expect(lien).toContain("15%E2%80%AF000%E2%80%AFFCFA");
    expect(lien).not.toContain("%25");
  });

  it("N'ENCODE PAS deux fois les caracteres deja licites", () => {
    // `'` est valide dans une chaine de requete. L'encoder a la main afficherait
    // %27 dans le message, et « l'article » deviendrait « l%27article ».
    const lien = lienWhatsApp("677123456", "l'article (neuf) !");
    expect(lien).toContain("l'article%20(neuf)%20!");
  });

  it("encode & et # — sinon le message est coupe", () => {
    const lien = lienWhatsApp("677123456", "a&b#c");
    expect(lien).toContain("a%26b%23c");
  });

  it("leve sur un numero non camerounais plutot que de fabriquer un lien mort", () => {
    for (const mauvais of ["", "12345", "+33612345678", "abc"]) {
      expect(() => lienWhatsApp(mauvais, "bonjour"), mauvais).toThrow();
    }
  });

  it("le texte se retrouve INTACT apres decodage", () => {
    const message = messageCommande({
      boutique: BOUTIQUE,
      lignes: [{ nom: "Robe wax « première qualité »", quantite: 2, prixUnitaireXaf: 7500 }],
    });
    const lien = lienWhatsApp("677123456", message);
    expect(texteDuLien(lien)).toBe(message);
  });
});

describe("lienCommande", () => {
  it("compose message et lien en une fois", () => {
    const lien = lienCommande("+237677123456", {
      boutique: BOUTIQUE,
      lignes: [{ nom: "Savon noir", quantite: 3, prixUnitaireXaf: 1500 }],
    });
    const texte = texteDuLien(lien);
    expect(texte).toContain("Savon noir");
    expect(texte).toContain(`Total : ${f("4 500 FCFA")}`);
    expect(texte).toContain(BOUTIQUE);
  });
});

/**
 * Le bloc de paiement (lot 9).
 *
 * « Si le lien echoue, l'acheteuse doit pouvoir payer quand meme. » Le numero de
 * reversement et le montant sont donc dans le TEXTE, pas seulement derriere une
 * rampe : iPhone bloque les liens USSD, un raccourci non verifie peut s'arreter
 * en route, et un forfait « WhatsApp seul » ne suit aucun lien externe.
 */
describe("bloc de paiement", () => {
  const commande = {
    boutique: BOUTIQUE,
    lignes: [{ nom: "Savon noir", quantite: 3, prixUnitaireXaf: 1500 }],
    paiement: { numeroReversement: "+237677123456", montantXaf: 4500 },
  };

  it("ecrit le numero de reversement et le montant en clair", () => {
    const texte = messageCommande(commande);
    // Espace tous les deux chiffres : un numero de neuf chiffres colles se
    // recopie mal sur un clavier de telephone, et un chiffre faux envoie
    // l'argent chez quelqu'un d'autre.
    expect(texte).toContain("Numero : 6 77 12 34 56");
    expect(texte).toContain(`Montant : ${f("4 500 FCFA")}`);
  });

  it("n'apparait PAS quand aucun versement n'est en cours", () => {
    // La fiche article publique ne connait pas le numero de reversement, et ne
    // doit pas le connaitre : il n'a rien a faire sur une page en cache CDN.
    const texte = messageCommande({ boutique: BOUTIQUE, lignes: commande.lignes });
    expect(texte).not.toContain("Paiement mobile money");
    expect(texte).not.toContain("Numero :");
  });

  it("laisse le contenu canonique intact et le place AVANT", () => {
    const texte = messageCommande(commande);
    expect(texte.indexOf("Boutique :")).toBeLessThan(texte.indexOf("Paiement mobile money"));
    expect(texte).toContain("Savon noir : 3");
  });

  it("survit a l'encodage du lien", () => {
    const texte = texteDuLien(lienCommande("677123456", commande));
    expect(texte).toContain("Numero : 6 77 12 34 56");
  });

  it("ne porte NULLE PART de quoi saisir un code secret", () => {
    // Le code secret se saisit dans la session de l'operateur. Un message qui le
    // demanderait serait exactement l'hameconnage que le produit combat.
    expect(messageCommande(commande).toLowerCase()).not.toMatch(
      /\b(pin|code[_ -]?secret|secret[_ -]?code|mot de passe)\b/,
    );
  });
});
