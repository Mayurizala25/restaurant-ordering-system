import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

const devLanHost =
  process.env.NEXT_PUBLIC_DEV_LAN_HOST ??
  (process.env.NODE_ENV === "development" ? getPrivateIPv4() : "");

function getPrivateIPv4(): string {
  const interfaces = networkInterfaces();
  const interfaceNames = Object.keys(interfaces).toSorted((left, right) => {
    const leftIsWifi = /wi-?fi|wlan|wireless/i.test(left) ? 1 : 0;
    const rightIsWifi = /wi-?fi|wlan|wireless/i.test(right) ? 1 : 0;
    return rightIsWifi - leftIsWifi;
  });

  for (const name of interfaceNames) {
    const address = interfaces[name]?.find((entry) => {
      if (entry.family !== "IPv4" || entry.internal) return false;
      const octets = entry.address.split(".").map(Number);
      return (
        octets.length === 4 &&
        (octets[0] === 10 ||
          (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
          (octets[0] === 192 && octets[1] === 168))
      );
    });
    if (address) return address.address;
  }

  return "";
}

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  env: {
    NEXT_PUBLIC_MENU_ORIGIN: process.env.NEXT_PUBLIC_MENU_ORIGIN ?? "",
    NEXT_PUBLIC_DEV_LAN_HOST: process.env.NODE_ENV === "development" ? devLanHost : "",
  },
  allowedDevOrigins:
    process.env.NODE_ENV === "development" && devLanHost ? [devLanHost] : [],
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
