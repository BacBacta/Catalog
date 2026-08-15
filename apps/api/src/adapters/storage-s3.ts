import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage, ObjetAStocker } from "../domain/storage.ts";
import { DELAI_RESEAU_MS } from "./fetch-borne.ts";

/**
 * Etablir une connexion est autrement plus rapide que transferer un objet :
 * une machine injoignable se declare en cinq secondes, pas en quinze.
 */
const DELAI_CONNEXION_MS = 5_000;

/**
 * Stockage S3 — compatible R2 et MinIO.
 *
 * `forcePathStyle` est vrai : MinIO et R2 servent en `hote/seau/cle` et non en
 * `seau.hote/cle`. Le style par sous-domaine est le defaut d'AWS et il echoue
 * silencieusement partout ailleurs, avec une erreur DNS qui ne dit rien du
 * probleme.
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export class S3Storage implements ObjectStorage {
  readonly name = "s3";
  readonly #client: S3Client;
  readonly #bucket: string;

  constructor(cfg: S3Config) {
    this.#bucket = cfg.bucket;
    this.#client = new S3Client({
      endpoint: cfg.endpoint,
      // R2 ignore la region mais l'exige dans la signature.
      region: cfg.region ?? "auto",
      forcePathStyle: true,
      credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
      /**
       * **La regle de `fetch-borne.ts`, appliquee au stockage.**
       *
       * Le SDK AWS n'utilise pas `fetch` : il a son propre client HTTP, et il
       * echappait donc a la borne posee apres le banc du 13/08/2026. Ses
       * delais par defaut valent ZERO, ce qui veut dire « pas de delai » — un
       * `HeadObject` vers un endpoint qui accepte la connexion puis se tait
       * suspend la promesse pour toujours, et la route entrante attend la fin
       * du traitement avant de rendre son 200. Panne parfaitement muette,
       * exactement la forme qui avait coute la soiree du 13.
       *
       * Le meme raisonnement, donc les memes quinze secondes : la borne ne
       * borne pas la performance, elle borne l'infini. Un depassement devient
       * une erreur ordinaire — `taille()` rend `null`, l'article se publie
       * sans photo — au lieu d'un fil qui s'arrete.
       */
      requestHandler: {
        requestTimeout: DELAI_RESEAU_MS,
        connectionTimeout: DELAI_CONNEXION_MS,
      },
    });
  }

  async put(objet: ObjetAStocker): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#bucket,
        Key: objet.cle,
        Body: objet.corps,
        ContentType: objet.contentType,
        // Les objets sont immuables : une nouvelle image reçoit une nouvelle cle.
        CacheControl: objet.cacheControl ?? "public, max-age=31536000, immutable",
      }),
    );
  }

  async urlSignee(cle: string, dureeSecondes: number): Promise<string> {
    return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: cle }), {
      expiresIn: dureeSecondes,
    });
  }

  async supprimer(cle: string): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: cle }));
  }

  async taille(cle: string): Promise<number | null> {
    try {
      const r = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: cle }));
      return r.ContentLength ?? null;
    } catch {
      // Objet absent, ou droits insuffisants. Dans les deux cas, on ne connait
      // pas la taille — et lever ici ferait echouer une lecture de liste.
      return null;
    }
  }

  async lire(cle: string): Promise<Uint8Array | null> {
    try {
      const r = await this.#client.send(new GetObjectCommand({ Bucket: this.#bucket, Key: cle }));
      const octets = await r.Body?.transformToByteArray();
      return octets ?? null;
    } catch {
      /* Meme regle que `taille` : un objet illisible n'est pas une panne. La
         carte-vitrine sortira avec son aplat au lieu de la photo. */
      return null;
    }
  }
}

/**
 * Stockage en memoire, pour le developpement et les tests.
 *
 * Il n'ecrit rien sur disque et disparait avec le processus. C'est ce qui permet
 * de parcourir toute la chaine d'images sans MinIO ni compte S3.
 *
 * **Il refuse de se charger en production.** Un stockage volatil en production,
 * ce sont des catalogues sans photos au premier redemarrage — panne silencieuse,
 * et la pire de ce module.
 */
export class MemoryStorage implements ObjectStorage {
  readonly name = "memoire";
  readonly objets = new Map<string, ObjetAStocker>();
  readonly #base: string;

  constructor(
    env: { NODE_ENV?: string | undefined } = process.env,
    base = "http://127.0.0.1:8787/api/media",
    // `string[]` et non `readonly string[]` : le garde `node-strip-only` cherche
    // `readonly\s+\w` dans les parametres de constructeur pour attraper les
    // proprietes de parametre, et ne distingue pas un TYPE d'un modificateur. Sa
    // sur-approximation est du bon cote — un faux positif agace, un faux negatif
    // fait sortir le serveur a l'import. On plie ici plutot que d'elargir le motif.
    manquantes: string[] = [],
  ) {
    if (env.NODE_ENV === "production") {
      throw new Error(
        "MemoryStorage est un stockage de developpement : en production, les " +
          "photos disparaitraient au premier redemarrage. " +
          (manquantes.length
            ? `Variables de stockage absentes : ${manquantes.join(", ")}.`
            : "Configurez S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY et S3_SECRET_KEY."),
      );
    }
    this.#base = base;
  }

  async put(objet: ObjetAStocker): Promise<void> {
    this.objets.set(objet.cle, objet);
  }

  /**
   * URL signee de facon simplifiee : l'echeance est dans le lien, et la route
   * `/api/media` la verifie. Ce n'est PAS un remplacement de la signature S3 —
   * juste de quoi que le parcours complet fonctionne sans fournisseur.
   */
  async urlSignee(cle: string, dureeSecondes: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + dureeSecondes;
    return `${this.#base}/${cle}?exp=${exp}`;
  }

  async supprimer(cle: string): Promise<void> {
    this.objets.delete(cle);
  }

  async taille(cle: string): Promise<number | null> {
    return this.objets.get(cle)?.corps.length ?? null;
  }

  async lire(cle: string): Promise<Uint8Array | null> {
    return this.objets.get(cle)?.corps ?? null;
  }
}

/**
 * Choisit le stockage d'apres la configuration. C'est le SEUL endroit ou un nom
 * de fournisseur apparait.
 *
 * Sans `S3_ENDPOINT`, on prend la memoire — et `MemoryStorage` refusera de se
 * construire en production, ce qui transforme un oubli de configuration en panne
 * immediate et lisible plutot qu'en perte de donnees differee.
 */
export function resolveStorage(env: NodeJS.ProcessEnv = process.env): ObjectStorage {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const accessKey = env.S3_ACCESS_KEY;
  const secretKey = env.S3_SECRET_KEY;
  if (endpoint && bucket && accessKey && secretKey) {
    return new S3Storage({
      endpoint,
      bucket,
      accessKey,
      secretKey,
      ...(env.S3_REGION ? { region: env.S3_REGION } : {}),
    });
  }
  /**
   * **Le repli exige les QUATRE variables, donc le message doit dire laquelle
   * manque.** Il ne nommait que `S3_ENDPOINT`, quelle que soit l'absente : un
   * `S3_SECRET_KEY` mal orthographie dans le `fly secrets set` produisait un
   * journal disant de configurer `S3_ENDPOINT`, que `fly secrets list` montrait
   * pourtant present. La machine boucle en redemarrage et l'operateur cherche du
   * cote de la seule variable qui, elle, est correcte.
   */
  return new MemoryStorage(env, undefined, manquantesS3(env));
}

/** Les variables de stockage absentes, dans l'ordre ou on les pose. */
function manquantesS3(env: NodeJS.ProcessEnv): string[] {
  return (["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const).filter(
    (k) => !env[k],
  );
}
