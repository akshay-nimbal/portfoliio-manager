/**
 * Build the Content-Security-Policy header.
 *
 * Production: tight policy - same-origin scripts/styles only, no eval, no
 * external connections, framing forbidden.
 *
 * Development: Next.js + webpack HMR need extra capabilities or the page
 * silently fails to hydrate:
 *   - 'unsafe-eval'  -> webpack's `eval()` source maps
 *   - 'unsafe-inline'-> Next.js dev runtime inline scripts
 *   - blob:          -> source-map blobs
 *   - ws:/wss: in connect-src for the HMR socket
 */
function buildCsp(isDev) {
  const scriptSrc = isDev
    ? "'self' 'unsafe-inline' 'unsafe-eval' blob:"
    : "'self' 'unsafe-inline'";
  const connectSrc = isDev ? "'self' ws: wss:" : "'self'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const isDev = process.env.NODE_ENV !== "production";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep heavy / dynamic-require packages outside the webpack bundle so
  // they're loaded by Node at runtime instead. `outputFileTracingIncludes`
  // makes sure the investor's workbook is shipped with the API route in
  // standalone builds (Vercel / Docker).
  experimental: {
    serverComponentsExternalPackages: ["xlsx"],
    outputFileTracingIncludes: {
      "/api/portfolio": ["./src/data/*.xlsx"],
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          { key: "Content-Security-Policy", value: buildCsp(isDev) },
        ],
      },
    ];
  },
};

export default nextConfig;
