/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A production build writes a different chunk map than the dev server's, so
  // running one against a live `next dev` leaves it loading modules that no
  // longer exist. `npm run verify` builds into its own directory instead.
  distDir: process.env.BUILD_DIR || ".next",
  images: {
    remotePatterns: [{protocol: "https", hostname: "pbs.twimg.com"}],
  },
  serverExternalPackages: ["sharp", "pg", "web-push"],
  experimental: {
    // Next 15 stopped reusing a visited dynamic page (stale time 0, was 30s).
    // Keep 14's 30s so back to a token or stock page is instant, as before.
    staleTimes: {dynamic: 30},
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {key: "Service-Worker-Allowed", value: "/"},
          {key: "Cache-Control", value: "no-cache"},
        ],
      },
    ];
  },
  webpack: (config) => {
    // Privy, WalletConnect and wagmi's connector barrel reference integrations
    // this app does not ship: Farcaster mini-apps, React Native storage,
    // MetaMask's SDK connector, and Coinbase's x402 payment protocol. They are
    // optional peers, so resolving them to false keeps the bundle honest
    // instead of pulling in SDKs nothing here calls.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@farcaster/mini-app-solana": false,
      "@react-native-async-storage/async-storage": false,
      "@metamask/connect-evm": false,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
      accounts: false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // ox (via viem's chain list, via Privy) builds a dynamic import expression
    // for its Tempo worker pool. Nothing here reaches it.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      {module: /ox[\/]_esm[\/]tempo/},
    ];
    return config;
  },
};

export default nextConfig;
