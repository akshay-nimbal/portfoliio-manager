"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Wraps the app in a single QueryClient.
 *
 * QueryClient is created lazily inside `useState` so it's stable across
 * renders but a fresh instance is built per browser session - this avoids
 * cross-user state if we ever move to a streaming SSR model.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // We retry once on failure - more would feel sluggish to the user.
            retry: 1,
            // Quotes are inherently stale, so do not block re-renders waiting
            // for "fresh" data; the polling interval drives refreshes.
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
