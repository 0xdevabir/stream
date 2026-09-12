/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // @stream/shared is TypeScript source in the workspace; Next has to compile
  // it rather than expect a prebuilt CommonJS bundle.
  transpilePackages: ["@stream/shared"],

  experimental: {
    // Keeps the dev-mode file watcher from crawling the whole monorepo.
    optimizePackageImports: ["@stream/shared"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // camera and microphone are needed by the browser "Go Live" path,
            // so they are allowed for same-origin only rather than denied.
            value: "camera=(self), microphone=(self), display-capture=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
