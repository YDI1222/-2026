import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite は Node ランタイム専用。バンドラに触らせない。
  serverExternalPackages: [],
  typedRoutes: false,
};

export default nextConfig;
