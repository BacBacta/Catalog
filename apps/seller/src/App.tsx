import { LoadingState } from "@catalog/ui";
import { lazy, Suspense } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Ecran } from "./components/Ecran.tsx";
import { SessionProvider } from "./lib/session.tsx";
import { ArticleForm } from "./routes/ArticleForm.tsx";
import { Articles } from "./routes/Articles.tsx";
import { CodeConnexion } from "./routes/CodeConnexion.tsx";
import { CollerSms } from "./routes/CollerSms.tsx";
import { Commandes } from "./routes/Commandes.tsx";
import { Connexion } from "./routes/Connexion.tsx";
import { Dashboard } from "./routes/Dashboard.tsx";
import { Reversement } from "./routes/Reversement.tsx";
import { UiDemo } from "./routes/UiDemo.tsx";
import { VerifierRecu } from "./routes/VerifierRecu.tsx";

/**
 * Les statistiques arrivent en PAQUET SEPARE, et c'est ce qui rend leur budget
 * mesurable.
 *
 * Ce n'est pas une optimisation de confort. Les graphiques et leurs vues tableau
 * ne servent qu'a cet ecran-la, que la vendeuse ouvre de temps en temps ; le
 * chemin quotidien, c'est les commandes et le collage du SMS. Les charger avec
 * le reste ferait payer a chaque ouverture, sur un telephone d'entree de gamme,
 * du code qui ne sert presque jamais.
 *
 * Surtout, un paquet a part se PESE : `scripts/budget.mjs` verifie que celui-ci
 * reste sous son plafond, et ce plafond est trop bas pour qu'une bibliotheque de
 * graphiques y entre. L'interdit du lot 13 devient une regle de compilation
 * plutot qu'une bonne intention.
 */
const Statistiques = lazy(() =>
  import("./routes/Statistiques.tsx").then((m) => ({ default: m.Statistiques })),
);

const router = createBrowserRouter([
  { path: "/", element: <Dashboard /> },
  { path: "/connexion", element: <Connexion /> },
  { path: "/connexion/code", element: <CodeConnexion /> },
  { path: "/reversement", element: <Reversement /> },
  { path: "/articles", element: <Articles /> },
  { path: "/articles/nouveau", element: <ArticleForm /> },
  { path: "/articles/:id", element: <ArticleForm /> },
  { path: "/commandes", element: <Commandes /> },
  { path: "/commandes/:orderId/preuve", element: <CollerSms /> },
  { path: "/verifier", element: <VerifierRecu /> },
  {
    path: "/statistiques",
    element: (
      <Suspense
        fallback={
          <Ecran titre="Vos chiffres" surtitre="Statistiques">
            <LoadingState label="Ouverture de vos chiffres…" lines={5} />
          </Ecran>
        }
      >
        <Statistiques />
      </Suspense>
    ),
  },
  // Page de demonstration du design system (lot 2). Elle est la cible du
  // controle axe-core et de la mesure de poids JS.
  { path: "/demo", element: <UiDemo /> },
]);

/**
 * `SessionProvider` entoure le routeur, pas l'inverse : la session est consultee
 * une seule fois a l'ouverture, et chaque changement d'ecran la retrouve deja
 * chargee. A l'interieur du routeur, chaque navigation la redemanderait.
 */
export function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  );
}
