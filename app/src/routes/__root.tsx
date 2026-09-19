import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
// Page metadata (browser <title>/favicon + social og: tags) read at build time.
import appMetaJson from "../app-meta.json";

const DEFAULT_TITLE = "ThermaSight";
const DEFAULT_DESCRIPTION =
  "Intelligent energy and equipment monitoring: unsupervised ML finds contextual anomalies in chiller telemetry and turns them into actionable insights.";

type AppMeta = {
  og_title?: string | null;
  og_description?: string | null;
  og_image_url?: string | null;
  favicon_url?: string | null;
  og_video_url?: string | null;
};

const appMeta = appMetaJson as AppMeta;

function toOwnAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/")) return value;
  try {
    const u = new URL(value);
    return u.pathname + u.search;
  } catch {
    return value;
  }
}

function buildHead(meta: AppMeta) {
  const title = meta.og_title ?? DEFAULT_TITLE;
  const description = meta.og_description ?? DEFAULT_DESCRIPTION;
  const ogImage = toOwnAssetUrl(meta.og_image_url);
  const favicon = toOwnAssetUrl(meta.favicon_url);
  const ogVideo = toOwnAssetUrl(meta.og_video_url);

  return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: ogImage ? "summary_large_image" : "summary" },
      ...(ogImage
        ? [
            { property: "og:image", content: ogImage },
            { name: "twitter:image", content: ogImage },
          ]
        : []),
      ...(ogVideo ? [{ property: "og:video", content: ogVideo }] : []),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      ...(favicon ? [{ rel: "icon", href: favicon }] : []),
    ],
  };
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-dvh items-center justify-center ts-page-bg px-4">
      <div className="max-w-md text-center">
        <p className="mono text-sm text-[var(--ts-text-dim)]">404</p>
        <h1 className="text-xl font-semibold text-[var(--ts-text)]">Page not found</h1>
        <p className="mt-2 text-sm text-[var(--ts-text-dim)]">
          The page you are looking for does not exist or has moved.
        </p>
        <Link to="/" className="mt-4 inline-flex ts-btn ts-btn-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    // no-op to satisfy exhaustive-deps lints; error already logged
  }, []);
  void error;

  return (
    <div className="flex min-h-dvh items-center justify-center ts-page-bg px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold text-[var(--ts-text)]">This page did not load</h1>
        <p className="mt-2 text-sm text-[var(--ts-text-dim)]">
          Something went wrong on our end. Refresh, or head back to the overview.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="ts-btn ts-btn-primary"
          >
            Try again
          </button>
          <a href="/" className="ts-btn ts-btn-ghost">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => buildHead(appMeta),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "light" }}>
      <head>
        <HeadContent />
      </head>
      <body className="ts-page-bg">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  );
}