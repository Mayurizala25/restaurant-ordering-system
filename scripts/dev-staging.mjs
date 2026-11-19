import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface, emitKeypressEvents } from "node:readline";
import { stdin, stdout } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFiles = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseEnv(contents, filename) {
  const values = {};
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid environment syntax in ${filename}:${index + 1}.`);

    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function readOptionalEnv(filename) {
  try {
    return parseEnv(await readFile(join(root, filename), "utf8"), filename);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function getOrigin(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(`${name} must use HTTPS or a loopback HTTP address.`);
  }
  if (
    url.username ||
    url.password ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must not include credentials, a path, or query parameters.`);
  }
  return url.origin;
}

async function askLine(label) {
  if (stdin.readableEnded || stdin.destroyed) {
    throw new Error("Input ended; staging was not started.");
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await prompt.question(`${label}: `);
    return typeof answer === "string" ? answer : "";
  } catch {
    throw new Error("Input was interrupted; staging was not started.");
  } finally {
    prompt.close();
  }
}

function askSecret(label) {
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run npm run dev:staging in an interactive terminal.");
  }

  emitKeypressEvents(stdin);
  const previousRawMode = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write(`${label}: `);

  return new Promise((resolveValue, reject) => {
    let value = "";

    function finish(error) {
      stdin.off("keypress", onKeypress);
      stdin.off("end", onEnd);
      stdin.setRawMode(previousRawMode ?? false);
      stdout.write("\n");
      if (error) reject(error);
      else resolveValue(value);
    }

    function onEnd() {
      finish(new Error("Input ended; staging was not started."));
    }

    function onKeypress(character, key = {}) {
      if ((key.ctrl && key.name === "c") || character === "\u0003") {
        finish(new Error("Input was interrupted; staging was not started."));
        return;
      }
      if (key.name === "return" || character === "\r" || character === "\n") {
        finish();
        return;
      }
      if (
        key.name === "backspace" ||
        character === "\u007f" ||
        character === "\b"
      ) {
        const chars = [...value];
        if (chars.length) {
          chars.pop();
          value = chars.join("");
          stdout.write("\b \b");
        }
        return;
      }
      if (!character || key.ctrl || key.meta) return;

      const printable = [...character].filter(
        (char) => char >= " " && char !== "\u001b",
      );
      if (printable.length) {
        value += printable.join("");
        stdout.write("*".repeat(printable.length));
      }
    }

    stdin.on("keypress", onKeypress);
    stdin.once("end", onEnd);
  });
}

async function askRequired({ label, read, notify, validate, preserveWhitespace = false }) {
  while (true) {
    let answer;
    try {
      answer = await read(label);
    } catch (error) {
      if (error instanceof Error && error.message.includes("staging was not started")) {
        throw error;
      }
      throw new Error(`${label} input failed; staging was not started.`);
    }

    const value = typeof answer === "string" ? answer : "";
    if (!value.trim()) {
      notify(`${label} is required. Please try again.`);
      continue;
    }

    const issue = validate?.(value);
    if (issue) {
      notify(issue);
      continue;
    }
    return preserveWhitespace ? value : value.trim();
  }
}

export async function collectStagingConfiguration({
  productionEnv,
  readLine,
  readSecret,
  notify = () => {},
}) {
  let productionOrigins;
  try {
    productionOrigins = [
      productionEnv.SUPABASE_URL,
      productionEnv.NEXT_PUBLIC_SUPABASE_URL,
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => new URL(value).origin);
  } catch {
    throw new Error("Could not verify the production project URL; refusing to continue.");
  }
  if (!productionOrigins.length) {
    throw new Error("Production project URL is unavailable for comparison; refusing to continue.");
  }

  let rawSupabaseUrl;
  try {
    rawSupabaseUrl = await readLine("Separate staging Supabase Project URL");
  } catch {
    throw new Error("Staging Supabase URL input failed; staging was not started.");
  }
  const supabaseUrl =
    typeof rawSupabaseUrl === "string" ? rawSupabaseUrl.trim() : "";
  if (!supabaseUrl) {
    throw new Error("Staging Supabase URL is required; staging was not started.");
  }

  let stagingOrigin;
  try {
    stagingOrigin = getOrigin(supabaseUrl, "Staging Project URL");
  } catch (error) {
    throw new Error(`Invalid staging Supabase URL: ${error.message}`);
  }
  if (productionOrigins.includes(stagingOrigin)) {
    throw new Error("Staging URL matches .env.local; refusing to continue.");
  }

  await askRequired({
    label: "Type STAGING to confirm this is a disposable non-production project",
    read: readLine,
    notify,
    validate(value) {
      return value.trim() === "STAGING"
        ? null
        : "Confirmation must be exactly STAGING. Please try again.";
    },
  });

  const serviceRoleKey = await askRequired({
    label: "Staging service-role key (input hidden)",
    read: readSecret,
    notify,
    validate(value) {
      return productionEnv.SUPABASE_SERVICE_ROLE_KEY === value
        ? "Service-role key matches .env.local. Enter the staging-only key."
        : null;
    },
  });
  const restaurantId = await askRequired({
    label: "Staging restaurant UUID",
    read: readLine,
    notify,
    validate(value) {
      return uuidPattern.test(value.trim())
        ? null
        : "Restaurant ID must be a UUID. Please try again.";
    },
  });
  const adminEmail = await askRequired({
    label: "Staging Admin email",
    read: readLine,
    notify,
  });
  const adminPassword = await askRequired({
    label: "Staging Admin password (input hidden)",
    read: readSecret,
    notify,
    preserveWhitespace: true,
    validate(value) {
      return productionEnv.ADMIN_PASSWORD === value
        ? "Admin password matches .env.local. Enter a staging-only password."
        : null;
    },
  });
  const sessionSecret = await askRequired({
    label: "Staging session secret (input hidden)",
    read: readSecret,
    notify,
    preserveWhitespace: true,
    validate(value) {
      if (value.length < 32) {
        return "Session secret must be at least 32 characters. Please try again.";
      }
      return productionEnv.ADMIN_SESSION_SECRET === value
        ? "Session secret matches .env.local. Enter a staging-only secret."
        : null;
    },
  });

  return {
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    SUPABASE_RESTAURANT_ID: restaurantId,
    ADMIN_EMAIL: adminEmail,
    ADMIN_PASSWORD: adminPassword,
    ADMIN_SESSION_SECRET: sessionSecret,
  };
}

async function main() {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error("Run npm run dev:staging in an interactive terminal.");
  }

  const productionEnv = await readOptionalEnv(".env.local");
  const staging = await collectStagingConfiguration({
    productionEnv,
    readLine: askLine,
    readSecret: askSecret,
    notify: (message) => console.error(message),
  });

  const childEnv = { ...process.env };
  for (const filename of envFiles) {
    const fileEnv = await readOptionalEnv(filename);
    for (const key of Object.keys(fileEnv)) childEnv[key] = "";
  }
  for (const key of Object.keys(childEnv)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|ADMIN_)/.test(key)) {
      childEnv[key] = "";
    }
  }
  Object.assign(childEnv, staging, {
    NEXT_PUBLIC_SUPABASE_URL: staging.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    NEXT_PUBLIC_MENU_ORIGIN: "http://localhost:3001",
  });

  console.log("Staging URL differs from .env.local. Starting on http://localhost:3001.");
  const child = spawn(
    process.execPath,
    [
      join(root, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3001",
    ],
    {
      cwd: root,
      env: childEnv,
      stdio: "inherit",
    },
  );
  for (const key of Object.keys(staging)) staging[key] = "";
  for (const key of Object.keys(childEnv)) {
    if (/^(SUPABASE_|NEXT_PUBLIC_SUPABASE_|ADMIN_)/.test(key)) {
      childEnv[key] = "";
    }
  }

  child.on("error", () => {
    console.error("Could not start the staging development server.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Could not start staging.");
    process.exitCode = 1;
  });
}
