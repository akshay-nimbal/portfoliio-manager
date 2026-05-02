// CSP. Prod is locked down; dev needs extras or Next's HMR silently kills
// the page (you get a blank screen, no console error - took a while to
// figure that one out the first time).
//   unsafe-eval   - webpack's eval() source maps
//   unsafe-inline - Next dev runtime inline scripts
//   blob:         - source-map blobs
//   ws:/wss:      - HMR websocket in connect-src
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
  experimental: {
    // xlsx uses dynamic requires - leave it to Node at runtime instead of
    // letting webpack bundle it (saves a bunch of warnings + bundle size).
    serverComponentsExternalPackages: ["xlsx"],
    // Make sure the workbook is copied into the standalone build's
    // function bundle (Vercel / Docker), otherwise the API route 500s in
    // prod with ENOENT.
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
