import { Outlet } from "react-router";
import { BarreNav } from "./BarreNav.tsx";

/**
 * La coquille des ecrans CONNECTES : l'ecran au-dessus, la barre de navigation
 * en dessous. Les ecrans d'authentification ne l'ont pas — une barre a cinq
 * destinations n'a aucun sens pour quelqu'un qui n'est pas encore entre.
 *
 * Le remplissage bas (`pb-24`) laisse le dernier element d'un ecran remonter
 * au-dessus de la barre : sans lui, le bouton final d'un formulaire se
 * retrouverait cache derriere elle.
 */
export function Coquille() {
  return (
    <div className="pb-24">
      <Outlet />
      <BarreNav />
    </div>
  );
}
