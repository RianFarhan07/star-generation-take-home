import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-only route badge sits bottom-left by default, on top of the sidebar's "Sign out".
  devIndicators: { position: "bottom-right" },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
