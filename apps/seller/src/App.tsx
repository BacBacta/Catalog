import { createBrowserRouter, RouterProvider } from "react-router";
import { SessionProvider } from "./lib/session.tsx";
import { ArticleForm } from "./routes/ArticleForm.tsx";
import { Articles } from "./routes/Articles.tsx";
import { CodeConnexion } from "./routes/CodeConnexion.tsx";
import { Connexion } from "./routes/Connexion.tsx";
import { Dashboard } from "./routes/Dashboard.tsx";
import { Reversement } from "./routes/Reversement.tsx";
import { UiDemo } from "./routes/UiDemo.tsx";

const router = createBrowserRouter([
  { path: "/", element: <Dashboard /> },
  { path: "/connexion", element: <Connexion /> },
  { path: "/connexion/code", element: <CodeConnexion /> },
  { path: "/reversement", element: <Reversement /> },
  { path: "/articles", element: <Articles /> },
  { path: "/articles/nouveau", element: <ArticleForm /> },
  { path: "/articles/:id", element: <ArticleForm /> },
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
