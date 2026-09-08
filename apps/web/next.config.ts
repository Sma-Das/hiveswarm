import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ["@hiveswarm/contracts"],
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
