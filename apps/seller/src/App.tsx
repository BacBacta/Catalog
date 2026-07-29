import { createBrowserRouter, RouterProvider } from "react-router";
import { Dashboard } from "./routes/Dashboard.tsx";
import { UiDemo } from "./routes/UiDemo.tsx";

const router = createBrowserRouter([
  { path: "/", element: <Dashboard /> },
  // Page de demonstration du design system (lot 2). Elle est la cible du
  // controle axe-core et de la mesure de poids JS.
  { path: "/demo", element: <UiDemo /> },
]);

export function App() {
  return <RouterProvider router={router} />;
}
