import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dreamnest fase 0.5: with the flag the Studio has an address per channel. A real 307 keeps the #tab of old bookmarks.
  async redirects() {
    return process.env.FEATURE_DREAMNEST === "true" ? [{ source: "/", destination: "/studio/kivoxel", permanent: false }] : [];
  },
  // The app is on the public internet from package 27 on.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
