import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@hiveswarm/contracts"],
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
