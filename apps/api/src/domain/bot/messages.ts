/**
 * Constructeurs des messages sortants du bot — ADR 0031.
 *
 * Le format est celui de la Cloud API de Meta, que 360dialog expose tel quel.
 * Les LIMITES de l'API sont tenues ici et testees : un depassement au moment
 * de l'envoi serait un refus HTTP silencieux pour l'acheteuse.
 *
 * Deux familles de textes, deux regles :
 * - les textes STATIQUES (libelles du produit) : une erreur de longueur est un
 *   bogue d'appelant, elle LEVE ;
 * - les textes venus des DONNEES (nom d'article d'une vendeuse) : troncature
 *   propre avec une ellipse — une vendeuse au nom trop long vend quand meme.
 */

/**
 * La limite d'un message TEXTE.
 */
const CORPS_TEXTE_MAX = 4096;

/**
 * La limite d'un corps INTERACTIF — ADR 0053.
 *
 * Elle n'est PAS la meme, et le depot les confondait : un corps entre 1 025 et
 * 4 096 caracteres passait la validation locale et mourait en HTTP 400 a
 * l'envoi, sans un message pour personne. Le menu vendeuse mesure environ 600
 * caracteres ; une fiche article a longue description depasse 1 400.
 */
export const CORPS_INTERACTIF_MAX = 1024;
const BOUTON_TITRE_MAX = 20;
const BOUTONS_MAX = 3;
const LISTE_LIGNES_MAX = 10;
const LIGNE_TITRE_MAX = 24;
const LIGNE_DESCRIPTION_MAX = 72;
/** Le pied d'un message interactif — 60 caracteres, reference Meta. */
const PIED_MAX = 60;
const LEGENDE_MAX = 1024;

export interface MessageTexte {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  /** Present : le message CITE celui-la — la reponse contextuelle (ADR 0035). */
  context?: { message_id: string };
  text: { body: string; preview_url: boolean };
}

/**
 * Une reaction posee SUR un message recu — l'accuse sans bruit (ADR 0035) :
 * le 👍 sur la photo d'article, le ✅ sur le SMS colle. Toujours un envoi de
 * CONFORT : l'appelant l'envoie en mieux-disant, jamais en chemin critique.
 */
export interface MessageReaction {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "reaction";
  reaction: { message_id: string; emoji: string };
}

export interface BoutonReponse {
  type: "reply";
  reply: { id: string; title: string };
}

export interface MessageBoutons {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  /** Present : le message CITE celui-la (ADR 0035). */
  context?: { message_id: string };
  interactive: {
    type: "button";
    /**
     * En-tete image optionnel — la vitrine d'une boutique, la photo d'un
     * article. Le lien doit etre lisible par les serveurs de Meta AU MOMENT de
     * l'envoi : un lien mort fait refuser le message entier, pas seulement
     * l'image. C'est l'appelant qui garantit l'existence de l'objet.
     */
    header?: { type: "image"; image: { link: string } };
    body: { text: string };
    action: { buttons: BoutonReponse[] };
  };
}

export interface LigneListe {
  id: string;
  title: string;
  description?: string;
}

export interface MessageListe {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "list";
    body: { text: string };
    /**
     * Le pied — plus petit, plus pale que le corps. C'est la ou va ce qui
     * doit RESTER sous les yeux sans peser : une legon, jamais une action.
     */
    footer?: { text: string };
    action: { button: string; sections: Array<{ rows: LigneListe[] }> };
  };
}

/**
 * Une photo pleine largeur, avec sa legende — la fiche article « image
 * d'abord » et la rafale « voir en photos » (ADR 0035). Comme l'en-tete des
 * messages a boutons : le lien doit etre lisible par les serveurs de Meta AU
 * MOMENT de l'envoi, et c'est l'appelant qui le garantit.
 */
export interface MessageImage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image";
  image: { link: string; caption?: string };
}

/**
 * Un message de GABARIT — ADR 0054. La seule forme qui ouvre une fenetre
 * fermee, et la seule que Meta facture.
 */
export interface MessageGabarit {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components: Array<{ type: "body"; parameters: Array<{ type: "text"; text: string }> }>;
  };
}

/**
 * Le message qui OUVRE un Flow — ADR 0055. Non verifie contre un Flow reel :
 * l'API de notre cle n'expose pas les Flows.
 */
export interface MessageFlux {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "flow";
    body: { text: string };
    action: {
      name: "flow";
      parameters: {
        flow_message_version: "3";
        flow_id: string;
        flow_cta: string;
        flow_action: "navigate";
        /** Jetable, propre a cet envoi — JAMAIS le jeton acheteuse (ADR 0021). */
        flow_token: string;
      };
    };
  };
}

/**
 * La demande de position — sprint « le bot devient une application ».
 *
 * Meta ouvre la carte du telephone et renvoie un point. Il n'y a pas de
 * bouton de reponse a cote : cette forme n'accepte qu'une action, `send_location`.
 * C'est pour cela qu'elle est envoyee EN PLUS de la question de livraison, et
 * jamais a sa place — les sorties de secours (« parler a la vendeuse »,
 * « annuler ») restent sur la question, la ou elles doivent etre.
 *
 * **Le point ne remplace rien** (ADR 0005) : il n'existe pas d'adresse au
 * Cameroun, le quartier, le repere et le telephone restent obligatoires. Ce
 * message dit « en plus, si vous voulez », et son texte doit le dire aussi.
 */
export interface MessageDemandeLocalisation {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "location_request_message";
    body: { text: string };
    action: { name: "send_location" };
  };
}

/**
 * Le BOUTON-LIEN (`cta_url`) — mesure le 13/08 (accepte par l'API, ADR 0087)
 * puis le 14/08 (s'affiche bien comme un bouton, ADR 0097).
 *
 * ── La regle qui decide ce qui devient un bouton ──────────────────────────
 *
 * Un lien devient un bouton quand le lecteur doit l'**ouvrir**. Il reste du
 * texte quand le lecteur doit le **copier, le partager ou le transmettre** :
 * un bouton ne se copie pas. Convertir le lien de boutique de la vendeuse
 * — « partagez-le, mettez-le en Statut » — le rendrait inutilisable pour son
 * seul usage.
 *
 * S'y ajoute la frontiere de l'ADR 0088 : `cta_url` sert « va voir cette
 * page », jamais « prends cette decision ». Une confirmation, une annulation,
 * un choix de livraison restent des boutons de reponse.
 *
 * ── UN bouton, et un seul ─────────────────────────────────────────────────
 *
 * `action.parameters` est un couple unique. Un message qui porte trois liens
 * n'en promeut donc qu'UN, et les deux autres restent en texte — plutot que
 * d'eclater le message en trois, ce que l'ADR 0086 interdit : quatre messages
 * consecutifs ont le meme poids visuel, et le porteur du produit l'a vecu
 * comme un « deluge de liens ».
 *
 * Un message `cta_url` ne peut pas non plus porter de boutons de reponse :
 * les deux sont des formes `interactive` exclusives.
 */
export interface MessageLienBouton {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "cta_url";
    body: { text: string };
    action: {
      name: "cta_url";
      parameters: { display_text: string; url: string };
    };
  };
}

export type MessageSortant =
  | MessageTexte
  | MessageBoutons
  | MessageListe
  | MessageImage
  | MessageReaction
  | MessageGabarit
  | MessageFlux
  | MessageDemandeLocalisation
  | MessageLienBouton;

/**
 * L'accuse de lecture, et l'indicateur de frappe qui voyage avec — ADR 0049.
 *
 * Ce n'est PAS un `MessageSortant` : il ne porte ni destinataire ni contenu,
 * il designe un message recu. Il part sur la meme route (`POST /messages`),
 * et c'est la seule chose qu'il partage avec un message. Le garder hors de
 * l'union evite qu'il traverse `envoyerSequence`, dont les replis n'ont
 * aucun sens ici.
 *
 * L'indicateur de frappe se dissipe seul : a l'envoi du message suivant, ou
 * au bout de 25 secondes. On ne l'eteint donc jamais a la main — il n'y a
 * rien a nettoyer si le traitement echoue.
 */
export interface AccuseLecture {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator?: { type: "text" };
}

export function accuseLecture(
  messageId: string,
  options: { frappe?: boolean } = {},
): AccuseLecture {
  if (!messageId.trim()) throw new Error("un accuse de lecture exige l'identifiant du message");
  return {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    ...(options.frappe ? { typing_indicator: { type: "text" as const } } : {}),
  };
}

/** Troncature propre : jamais plus de `max`, ellipse comprise. */
function tronquer(texte: string, max: number): string {
  const net = texte.trim();
  if (net.length <= max) return net;
  return `${net.slice(0, max - 1).trimEnd()}…`;
}

function corpsOuLeve(corps: string, max = CORPS_TEXTE_MAX): string {
  const net = corps.trim();
  if (!net) throw new Error("le corps d'un message ne peut pas etre vide");
  return tronquer(net, max);
}

export function texte(vers: string, corps: string, options: { citer?: string } = {}): MessageTexte {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "text",
    ...(options.citer ? { context: { message_id: options.citer } } : {}),
    text: { body: corpsOuLeve(corps), preview_url: false },
  };
}

export function reaction(vers: string, messageId: string, emoji: string): MessageReaction {
  if (!messageId.trim()) throw new Error("une reaction exige le message cible");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "reaction",
    reaction: { message_id: messageId, emoji },
  };
}

/**
 * Un message de gabarit — ADR 0054.
 *
 * Les parametres sont NETTOYES de leurs sauts de ligne : Meta rejette l'envoi
 * entier si un seul en porte un, et la notification serait perdue pour une
 * virgule. Un parametre vide est refuse de la meme facon — l'appelant le
 * verifie avec `variablesManquantes` avant d'arriver ici.
 */
export function gabarit(
  vers: string,
  g: { nom: string; variables: number },
  langue: string,
  parametres: readonly string[],
): MessageGabarit {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "template",
    template: {
      name: g.nom,
      language: { code: langue },
      components: [
        {
          type: "body",
          parameters: parametres.map((p) => ({
            type: "text" as const,
            text: p.replace(/\s*\n+\s*/g, " ").trim(),
          })),
        },
      ],
    },
  };
}

/** Retire la citation d'un message — le repli quand l'API la refuse. */
export function sansCitation<M extends { context?: { message_id: string } }>(m: M): M {
  const { context: _context, ...reste } = m;
  return reste as M;
}

export function image(vers: string, lien: string, legende?: string): MessageImage {
  if (!lien.trim()) throw new Error("un message image exige un lien");
  const nette = legende?.trim();
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "image",
    /* La legende vient des DONNEES (nom d'article, prix) : troncature propre,
       jamais de levee — une vendeuse au nom trop long vend quand meme. */
    image: { link: lien, ...(nette ? { caption: tronquer(nette, LEGENDE_MAX) } : {}) },
  };
}

/**
 * Demande la position de l'acheteuse. Le corps est EXIGE : un bouton
 * « envoyer ma position » sans phrase au-dessus ne dit ni pourquoi, ni que
 * c'est facultatif.
 */
export function demandeLocalisation(vers: string, corps: string): MessageDemandeLocalisation {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "location_request_message",
      body: { text: corpsOuLeve(corps, CORPS_INTERACTIF_MAX) },
      action: { name: "send_location" },
    },
  };
}

/**
 * La borne du libelle. Elle est REPRISE de celle des boutons de reponse, et
 * ce n'est pas une mesure : la limite propre a `display_text` n'a pas ete
 * relevee — les pages de reference de Meta etaient inatteignables (HTTP 500,
 * 13/08) et notre sonde ne teste pas les bornes, elle teste l'acceptation.
 *
 * Vingt caracteres est donc un plancher prudent, pas un plafond connu. Le seul
 * libelle mesure accepte est « Ouvrir la boutique » — dix-huit.
 */
export const LIEN_LIBELLE_MAX = BOUTON_TITRE_MAX;

/**
 * Un message dont le lien devient un bouton. Voir `MessageLienBouton` pour la
 * regle qui decide ce qui a le droit d'y passer.
 */
export function lienBouton(
  vers: string,
  corps: string,
  libelle: string,
  url: string,
): MessageLienBouton {
  /**
   * ── `https://` et rien d'autre ────────────────────────────────────────
   *
   * La rampe de paiement est un lien `tel:` portant une chaine USSD (lot 9).
   * En faire un bouton le rendrait INERTE, et la panne serait silencieuse :
   * l'acheteuse verrait un bouton, le taperait, et rien ne s'ouvrirait. C'est
   * le seul chemin par lequel cette conversion pourrait casser le geste n° 1
   * du produit — il se ferme par une levee, pas par une convention.
   */
  if (!url.startsWith("https://")) {
    throw new Error(`un bouton-lien exige une URL https:// (recu : ${url.slice(0, 12)}…)`);
  }
  if (!libelle.trim()) throw new Error("libelle de bouton-lien vide : il ne se taperait pas");
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "cta_url",
      /* `corpsOuLeve` refuse un corps vide : un message reduit a un bouton ne
         dirait plus rien a qui ne peut pas l'ouvrir (AGENTS.md). */
      body: { text: corpsOuLeve(corps, CORPS_INTERACTIF_MAX) },
      action: {
        name: "cta_url",
        parameters: { display_text: tronquer(libelle, LIEN_LIBELLE_MAX), url },
      },
    },
  };
}

export function boutons(
  vers: string,
  corps: string,
  choix: ReadonlyArray<{ id: string; titre: string }>,
  options: { image?: string; citer?: string } = {},
): MessageBoutons {
  if (choix.length === 0) throw new Error("un message a boutons exige au moins un bouton");
  if (choix.length > BOUTONS_MAX)
    throw new Error(`l'API n'accepte pas plus de trois boutons (recu ${choix.length})`);
  const ids = new Set<string>();
  for (const c of choix) {
    if (!c.id.trim()) throw new Error("identifiant de bouton vide : le routage en depend");
    if (ids.has(c.id)) throw new Error(`identifiant de bouton en double : ${c.id}`);
    ids.add(c.id);
  }
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    ...(options.citer ? { context: { message_id: options.citer } } : {}),
    interactive: {
      type: "button",
      ...(options.image
        ? { header: { type: "image" as const, image: { link: options.image } } }
        : {}),
      body: { text: corpsOuLeve(corps, CORPS_INTERACTIF_MAX) },
      action: {
        buttons: choix.map((c) => ({
          type: "reply" as const,
          reply: { id: c.id, title: tronquer(c.titre, BOUTON_TITRE_MAX) },
        })),
      },
    },
  };
}

export function liste(
  vers: string,
  corps: string,
  libelleBouton: string,
  lignes: ReadonlyArray<{ id: string; titre: string; description?: string }>,
  pied?: string,
): MessageListe {
  if (lignes.length === 0) throw new Error("une liste exige au moins une ligne");
  if (lignes.length > LISTE_LIGNES_MAX)
    throw new Error(
      `l'API n'accepte pas plus de dix lignes de liste (recu ${lignes.length}) — paginer`,
    );
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: vers,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: corpsOuLeve(corps, CORPS_INTERACTIF_MAX) },
      ...(pied ? { footer: { text: tronquer(pied, PIED_MAX) } } : {}),
      action: {
        button: tronquer(libelleBouton, BOUTON_TITRE_MAX),
        sections: [
          {
            rows: lignes.map((l) => ({
              id: l.id,
              title: tronquer(l.titre, LIGNE_TITRE_MAX),
              ...(l.description
                ? { description: tronquer(l.description, LIGNE_DESCRIPTION_MAX) }
                : {}),
            })),
          },
        ],
      },
    },
  };
}
