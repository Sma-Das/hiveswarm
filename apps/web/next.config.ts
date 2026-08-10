import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hiveswarm/contracts"],
  output: "standalone",
};

export default nextConfig;
