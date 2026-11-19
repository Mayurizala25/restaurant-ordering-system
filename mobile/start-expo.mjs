import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function isPrivateIPv4(address) {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function getDefaultRouteIPv4() {
  return new Promise((resolveAddress, reject) => {
    const socket = createSocket("udp4");
    socket.once("error", reject);
    // UDP connect selects the OS route without sending a packet.
    socket.connect(9, "192.0.2.1", () => {
      const { address } = socket.address();
      socket.close();
      if (isPrivateIPv4(address)) {
        resolveAddress(address);
      } else {
        reject(new Error("The active default route has no private IPv4 address."));
      }
    });
  });
}

const lanHost = await getDefaultRouteIPv4().catch((error) => {
  console.error(`Could not detect the active LAN IPv4 address: ${error.message}`);
  process.exit(1);
});
const projectRoot = dirname(fileURLToPath(import.meta.url));
const expoCli = resolve(projectRoot, "node_modules", "expo", "bin", "cli");
const expoPort = 8081;
const webViewUrl =
  process.env.EXPO_PUBLIC_WEBVIEW_URL?.trim() || `http://${lanHost}:3000`;
console.log(`Open Expo Go with: exp://${lanHost}:${expoPort}`);
console.log(`Local website URL: ${webViewUrl}`);
const child = spawn(
  process.execPath,
  [
    expoCli,
    "start",
    "--go",
    "--host",
    "lan",
    "--port",
    String(expoPort),
    ...process.argv.slice(2),
  ],
  {
    cwd: projectRoot,
    env: {
      ...process.env,
      REACT_NATIVE_PACKAGER_HOSTNAME: lanHost,
      EXPO_PUBLIC_WEBVIEW_URL: webViewUrl,
    },
    stdio: "inherit",
  },
);

child.once("error", (error) => {
  console.error(`Could not start Expo Metro: ${error.message}`);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 0 : 1);
});
