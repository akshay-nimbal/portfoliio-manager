"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// One QueryClient per browser session. Built lazily inside useState so it's
// stable across renders without leaking across users if we ever move to
// streaming SSR.
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1, // more than one feels sluggish on a manual refresh
            // Quotes are stale by definition - the polling interval is what
            // actually drives refreshes here.
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
