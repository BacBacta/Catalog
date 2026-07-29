import { createBrowserRouter, RouterProvider } from "react-router";
import { Dashboard } from "./routes/Dashboard.tsx";

const router = createBrowserRouter([{ path: "/", element: <Dashboard /> }]);

export function App() {
  return <RouterProvider router={router} />;
}
