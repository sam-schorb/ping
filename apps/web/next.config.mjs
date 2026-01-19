import { fileURLToPath } from "url";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@ping/core", "@ping/ui"],
  outputFileTracingRoot: workspaceRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
