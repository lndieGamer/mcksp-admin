import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider, createHashRouter } from "react-router-dom";

import App from "./App";
import { captureSessionFromHash } from "./lib/api";
import Flavors from "./pages/Flavors";
import History from "./pages/History";
import Import from "./pages/Import";
import Lint from "./pages/Lint";
import Mods from "./pages/Mods";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import Updates from "./pages/Updates";
import "./index.css";

// Must run before the router reads the hash, or the token would look like a route.
captureSessionFromHash();

// Cytoscape is two thirds of the bundle and only /graph needs it. Players
// opening the mod table on a phone should not pay for a layout engine.
const Graph = React.lazy(() => import("./pages/Graph"));

const Lazy = ({ children }: { children: React.ReactNode }) => (
  <React.Suspense fallback={<p className="p-8 text-center text-xs text-faint">загружаю граф…</p>}>
    {children}
  </React.Suspense>
);

const router = createHashRouter([
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Overview /> },
      { path: "mods", element: <Mods /> },
      {
        path: "graph",
        element: (
          <Lazy>
            <Graph />
          </Lazy>
        ),
      },
      { path: "import", element: <Import /> },
      { path: "flavors", element: <Flavors /> },
      { path: "updates", element: <Updates /> },
      { path: "lint", element: <Lint /> },
      { path: "history", element: <History /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
