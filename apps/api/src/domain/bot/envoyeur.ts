import type { AccuseLecture, MessageSortant } from "./messages.ts";

/**
 * L'interface d'envoi du bot — definie ICI, dans le domaine, implementee par
 * un adaptateur (regle de dependance d'AGENTS.md §4 : `domain` ne depend de
 * rien, les `adapters` implementent ses interfaces).
 *
 * `envoyer` accepte les messages UN PAR UN et dans l'ordre : une conversation
 * est une sequence, et un catalogue arrive apres le message d'accueil, pas
 * dans un ordre de hasard decide par des promesses concurrentes.
 */
export interface EnvoyeurBot {
  readonly nom: string;
  envoyer(message: MessageSortant): Promise<void>;
  /**
   * L'accuse de lecture, et l'indicateur de frappe qui voyage avec — ADR 0049.
   *
   * FACULTATIF, et de CONFORT : un transport qui ne sait pas le faire reste un
   * transport valide, et un accuse refuse ne coute aucune conversation. C'est
   * la meme posture que la reaction et la citation (ADR 0035) — on tente, on
   * ne parie jamais le fil dessus.
   */
  accuser?(accuse: AccuseLecture): Promise<void>;
}
