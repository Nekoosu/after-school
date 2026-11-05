import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，必须排除在打包之外
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
