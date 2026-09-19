import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/** The router must match wherever it is hosted:
 *  - domain root (dev, or the platform worker): "/"
 *  - a GitHub Pages project subpath like "/thermasight-web/"
 *  Without this the client router sees the subpath as an unknown route and
 *  falls back to the 404 page even though the page content is right there. */
const detectBasepath = () => {
  if (typeof window === "undefined") return "/";
  let p = window.location.pathname;
  if (p.endsWith("index.html")) p = p.slice(0, -"index.html".length);
  if (!p.endsWith("/")) p = p + "/";
  return p;
};

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    basepath: detectBasepath(),
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

// Newer @tanstack/react-start build/dev tooling discovers the router by the
// `createRouter` export name; both names are provided for compatibility.
export const createRouterConfig = getRouter;
export const createRouterExport = getRouter;
