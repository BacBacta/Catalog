import { normalizePhone } from "@catalog/contracts";
import type { PrismaClient } from "@catalog/db";
import { Hono } from "hono";
import type { OtpAttemptStore } from "../adapters/otp-attempt-store.ts";
import type { PayoutOtpStore } from "../adapters/payout-otp-store.ts";
import { envoyerCodeBanc, numeroDuBanc } from "../banc-essai.ts";
import {
  appliquerChangementReversement,
  type PayoutChangeRequest,
  type ResultatChangement,
} from "../domain/payout-phone.ts";
import type { OtpLimits } from "../domain/rate-limit.ts";
import { decisionAlerte } from "../domain/securite/alerte-reversement.ts";
import type { SmsSender } from "../domain/sms-sender.ts";
import { texteSms } from "../domain/sms-sender.ts";
import { adresseDe, otpRateLimit } from "../middleware/otp-rate-limit.ts";
import { type SessionDeps, vendeuseCourante } from "./seller.ts";

/**
 * Changement du numero de reversement.
 *
 * La decision appartient au domaine (`payout-phone.ts`), qui est pur. Cette
 * couche ne fait que trois choses : lire l'etat, appeler le domaine, et
 * persister ce qu'il renvoie.
 *
 * **Le journal est ecrit dans TOUS les cas, refus compris, et dans la MEME
 * transaction que la modification.** Deux raisons :
 *
 * 1. une tentative refusee qui ne laisse pas de trace est une attaque
 *    invisible — et c'est precisement ce champ qu'un attaquant vise ;
 * 2. hors transaction, un numero pourrait changer sans que le journal le dise,
 *    ou l'inverse. Les deux sont pires que l'echec.
 */

export interface PayoutDeps {
  prisma: PrismaClient;
  /** Injectable pour les tests : le domaine ne lit jamais l'horloge. */
  maintenant?: () => Date;
  /**
   * L'envoi de l'alerte a l'ancien numero (ADR 0061, rang 2b). **Facultatif** :
   * absent, le changement se fait et se journalise comme avant — les tests qui
   * ne s'y interessent pas n'ont rien a fournir.
   */
  sms?: SmsSender;
  /**
   * Le numero du bot, ou l'ancien numero envoie STOP. Absent : l'alerte part
   * quand meme, en renvoyant vers le support — mieux vaut un avertissement
   * sans bouton qu'aucun avertissement.
   */
  numeroBot?: string;
}

/**
 * Applique un changement et persiste tout — modification si acceptee, journal
 * dans les deux cas. Exportee separement de la route pour etre testable contre
 * une vraie base sans passer par HTTP.
 */
export async function changerNumeroDeReversement(
  deps: PayoutDeps,
  entree: {
    sellerId: string;
    nouveauNumero: string;
    verification: PayoutChangeRequest["verification"];
    acteur: PayoutChangeRequest["acteur"];
  },
): Promise<ResultatChangement> {
  const now = deps.maintenant?.() ?? new Date();

  const vendeuse = await deps.prisma.seller.findUnique({
    where: { id: entree.sellerId },
    select: {
      id: true,
      phone: true,
      payoutPhone: true,
      payoutPhoneVerifiedAt: true,
      reversementGeleDepuis: true,
    },
  });
  if (!vendeuse) throw new Error(`vendeuse introuvable: ${entree.sellerId}`);

  /**
   * ── Le gel passe AVANT le domaine, et il ne se leve pas tout seul ──────
   *
   * Une vendeuse dont l'ancien numero a repondu STOP a signale un vol. Tant
   * qu'un humain n'a pas tranche, aucun numero ne se pose — y compris par
   * quelqu'un qui detient l'appareil et sait recevoir un OTP. C'est tout
   * l'interet du geste : l'OTP prouve qu'on tient une puce, pas qu'on est la
   * proprietaire.
   */
  if (vendeuse.reversementGeleDepuis) {
    const journal = {
      sellerId: vendeuse.id,
      kind: "reversement_refuse" as const,
      actor: entree.acteur.role,
      at: now,
      payload: {
        ancien: vendeuse.payoutPhone,
        nouveau: null,
        raison: "reversement_gele" as const,
        geleDepuis: vendeuse.reversementGeleDepuis.toISOString(),
      },
    };
    await deps.prisma.sellerAuditEvent.create({ data: journal });
    return { ok: false, raison: "reversement_gele" as const, journal };
  }

  const resultat = appliquerChangementReversement(
    {
      sellerId: vendeuse.id,
      loginPhone: vendeuse.phone,
      payoutPhone: vendeuse.payoutPhone,
      payoutPhoneVerifiedAt: vendeuse.payoutPhoneVerifiedAt,
    },
    { ...entree, now },
    /* La regle +237, elargie aux seuls numeros NOMMES du banc (ADR 0058) —
       liste vide par defaut, decision et journal inchanges. */
    (brut) => normalizePhone(brut) ?? numeroDuBanc(brut),
  );

  const journal = {
    sellerId: resultat.journal.sellerId,
    kind: resultat.journal.kind,
    actor: resultat.journal.actor,
    payload: resultat.journal.payload,
    at: resultat.journal.at,
  };

  await deps.prisma.$transaction(async (tx) => {
    if (resultat.ok) {
      await tx.seller.update({
        where: { id: entree.sellerId },
        data: resultat.changes,
      });
    }
    await tx.sellerAuditEvent.create({ data: journal });
  });

  /**
   * ── L'alerte a l'ANCIEN numero — ADR 0061, rang 2b ────────────────────
   *
   * Elle part APRES la transaction, et volontairement : le changement est
   * acquis, l'alerte est un plus. Une passerelle SMS injoignable ne doit pas
   * defaire une operation que la vendeuse a menee correctement — c'est la
   * meme lecon que la reconstruction de boutique (ADR 0065) : ce qui est en
   * plus ne casse pas ce qui est essentiel.
   *
   * Elle part par SMS, pas par le fil : sur un telephone vole, le fil est
   * entre les mains du voleur. La puce de secours, elle, recoit un SMS meme
   * dans un vieil appareil.
   */
  if (resultat.ok) {
    const decision = decisionAlerte({
      ancienNumero: vendeuse.payoutPhone,
      nouveauNumero: resultat.changes.payoutPhone,
    });
    if (decision.alerter) {
      try {
        await deps.sms?.send({
          to: decision.vers,
          text: texteSms("alerte_reversement", deps.numeroBot ?? ""),
          kind: "alerte_reversement",
        });
        await deps.prisma.sellerAuditEvent.create({
          data: {
            sellerId: vendeuse.id,
            kind: "reversement_alerte",
            actor: "systeme",
            /* Le numero alerte est la CLE du STOP : c'est par lui qu'on
               retrouve l'alerte quand la reponse arrive. */
            payload: { vers: decision.vers },
            at: now,
          },
        });
      } catch {
        /* Journalise sans detail : un message de passerelle peut refleter le
           numero appele (ADR 0023). L'echec ne remonte pas a la vendeuse. */
        console.warn("reversement : alerte a l'ancien numero non delivree");
      }
    }
  }

  return resultat;
}

/** Codes HTTP : un refus metier n'est pas une panne. */
const STATUT: Record<string, number> = {
  /* 423 Locked : ni une erreur de saisie, ni un droit manquant — un verrou. */
  reversement_gele: 423,
  verification_absente: 403,
  verification_dun_autre_numero: 403,
  verification_perimee: 403,
  numero_invalide: 422,
  numero_inchange: 409,
};

/**
 * Messages destines a la vendeuse, en francais simple. Ils disent quoi faire,
 * pas ce qui a echoue techniquement.
 */
const MESSAGE: Record<string, string> = {
  verification_absente:
    "Confirmez d'abord le nouveau numero avec le code que nous venons d'envoyer.",
  verification_dun_autre_numero:
    "Le code confirme un autre numero. Demandez un code pour le numero que vous voulez utiliser.",
  verification_perimee: "Le code a expire. Demandez-en un nouveau.",
  numero_invalide: "Ce numero ne ressemble pas a un numero camerounais.",
  numero_inchange: "C'est deja votre numero de reversement.",
  /* On ne dit PAS « vol signale » : si c'est le voleur qui lit, il apprendrait
     ce qui se passe et par ou passer. On dit qu'un humain doit intervenir. */
  reversement_gele:
    "Le changement de numero est suspendu sur ce compte. Contactez-nous pour le debloquer.",
};

/** Refus propres a la verification du code. Aucun n'est une panne. */
const STATUT_OTP: Record<string, number> = {
  aucun_code_en_cours: 409,
  code_expire: 410,
  code_deja_utilise: 409,
  trop_d_essais: 429,
  code_incorrect: 401,
};

const MESSAGE_OTP: Record<string, string> = {
  aucun_code_en_cours: "Demandez d'abord un code pour ce numero.",
  code_expire: "Le code a expire. Demandez-en un nouveau.",
  code_deja_utilise: "Ce code a deja servi. Demandez-en un nouveau.",
  trop_d_essais: "Trop de saisies incorrectes. Demandez un nouveau code.",
  code_incorrect: "Ce code ne correspond pas. Verifiez le SMS.",
};

export interface PayoutRoutesDeps extends PayoutDeps {
  session: SessionDeps;
  otp: PayoutOtpStore;
  sms: SmsSender;
  otpStore: OtpAttemptStore;
  /** Plafonds. Absents, les valeurs par defaut du domaine s'appliquent. */
  limits?: OtpLimits;
}

/**
 * Les deux routes du reversement.
 *
 * `POST /code` envoie l'OTP **au NOUVEAU numero**, jamais a l'ancien : c'est ce
 * qui prouve que la vendeuse tient bien la puce ou l'argent va arriver. Envoyer
 * a l'ancien numero verifierait qu'elle possede celui qu'elle quitte, ce qui ne
 * dit rien.
 *
 * `POST /` verifie le code puis delegue la decision au domaine. L'identite vient
 * de la SESSION, jamais du corps de la requete : un `sellerId` accepte depuis le
 * corps laisserait n'importe qui deplacer l'argent de n'importe qui.
 */
export function payoutRoutes(deps: PayoutRoutesDeps) {
  const r = new Hono();

  r.use(
    "/code",
    otpRateLimit({
      store: deps.otpStore,
      kind: "otp_reversement",
      ...(deps.limits ? { limits: deps.limits } : {}),
      ...(deps.maintenant ? { maintenant: deps.maintenant } : {}),
      numero: (corps) => {
        const n = (corps as { nouveauNumero?: unknown } | null)?.nouveauNumero;
        return typeof n === "string" ? normalizePhone(n) : null;
      },
    }),
  );

  r.post("/code", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
    if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);

    const corps = await c.req.json().catch(() => null);
    const brut = String(corps?.nouveauNumero ?? "");
    /* Les numeros NOMMES du banc d'essai (ADR 0058) sont admis aussi. La
       liste est VIDE par defaut : sans la variable, la regle +237 est
       exactement celle d'avant, et le journal d'audit trace le changement
       comme n'importe quel autre. */
    const banc = numeroDuBanc(brut);
    const numero = normalizePhone(brut) ?? banc;
    if (!numero) {
      return c.json(
        {
          erreur: "numero_invalide",
          message: MESSAGE.numero_invalide,
        },
        422,
      );
    }
    if (numero === v.seller.payoutPhone) {
      return c.json({ erreur: "numero_inchange", message: MESSAGE.numero_inchange }, 409);
    }

    const now = deps.maintenant?.() ?? new Date();
    const { code } = await deps.otp.emettre(v.seller.id, numero, now);
    /* Le code d'un numero du banc part par le WhatsApp du bot : le canal
       normal (SMS Orange Cameroun) ne livre pas hors du pays. */
    if (banc) {
      await envoyerCodeBanc(numero, texteSms("otp_reversement", code));
      return c.json({ envoye: true, numero });
    }
    await deps.sms.send({
      to: numero,
      text: texteSms("otp_reversement", code),
      kind: "otp_reversement",
      /** Le code brut, pour les canaux a gabarit. Voir `SmsMessage`. */
      valeur: code,
    });

    // Le corps de reponse ne porte NI le code, ni son empreinte.
    return c.json({ envoye: true, numero });
  });

  r.post("/", async (c) => {
    const v = await vendeuseCourante(deps.session, c.req.raw);
    if (!v) return c.json({ erreur: "non_authentifiee" }, 401);
    if (!v.seller) return c.json({ erreur: "profil_absent" }, 409);

    const corps = await c.req.json().catch(() => null);
    const nouveauNumero = String(corps?.nouveauNumero ?? "");
    const code = String(corps?.code ?? "");
    if (!nouveauNumero || !code) {
      return c.json({ erreur: "nouveauNumero et code sont requis" }, 422);
    }

    const now = deps.maintenant?.() ?? new Date();
    const verdict = await deps.otp.verifier(v.seller.id, code, now);

    const ip = adresseDe(c);
    const acteur = { role: "vendeuse" as const, ...(ip ? { ip } : {}) };

    // Un code refuse ne doit PAS ressortir en 500, et il doit laisser une trace :
    // on passe par le domaine avec `verification: null`, ce qui journalise le
    // refus exactement comme une tentative sans code.
    const verification = verdict.ok ? { numero: verdict.numero, verifieA: verdict.verifieA } : null;

    const resultat = await changerNumeroDeReversement(deps, {
      sellerId: v.seller.id,
      nouveauNumero,
      verification,
      acteur,
    });

    if (!resultat.ok) {
      // Quand c'est le code qui a echoue, on le dit precisement : « confirmez
      // d'abord » devant un code juste mais expire enverrait la vendeuse tourner
      // en rond.
      if (!verdict.ok) {
        return c.json(
          { erreur: verdict.raison, message: MESSAGE_OTP[verdict.raison] },
          (STATUT_OTP[verdict.raison] ?? 400) as 400,
        );
      }
      return c.json(
        { erreur: resultat.raison, message: MESSAGE[resultat.raison] },
        (STATUT[resultat.raison] ?? 400) as 400,
      );
    }
    return c.json({
      payoutPhone: resultat.changes.payoutPhone,
      payoutOperator: resultat.changes.payoutOperator,
    });
  });

  return r;
}
