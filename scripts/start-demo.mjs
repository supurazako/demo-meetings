import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";

const withTunnel = process.argv.includes("--tunnel");
const turnOnly = process.argv.includes("--turn-only");
const configOnly = process.argv.includes("--turn-config");
const children = new Set();
const env = loadLocalEnv();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    cleanup();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

try {
  const turnConfigFile = renderTurnConfig(env);
  if (configOnly) {
    process.exit(0);
  }

  await run("docker", ["compose", "up", "-d", "turn"], {
    env: { ...process.env, TURN_CONFIG_FILE: turnConfigFile },
  });
  if (turnOnly) {
    process.exit(0);
  }

  const dev = start("npm", ["run", "dev"], { stdio: "inherit" });
  let tunnel = null;
  if (withTunnel) {
    tunnel = start("cloudflared", ["tunnel", "run"], { stdio: "inherit" });
  }

  const code = await waitForExit([dev, tunnel].filter(Boolean));
  cleanup();
  process.exit(code);
} catch (error) {
  cleanup();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = start(command, args, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      children.delete(child);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`,
        ),
      );
    });
  });
}

function start(command, args, options) {
  const child = spawn(command, args, {
    ...options,
    shell: process.platform === "win32",
  });
  children.add(child);
  return child;
}

function waitForExit(processes) {
  return new Promise((resolve) => {
    for (const child of processes) {
      child.on("error", () => {
        resolve(1);
      });
      child.on("exit", (code) => {
        resolve(code ?? 1);
      });
    }
  });
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }
  children.clear();
}

function loadLocalEnv() {
  const values = { ...process.env };
  try {
    const text = readFileSync(".env.local", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const index = trimmed.indexOf("=");
      if (index === -1) {
        continue;
      }
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      values[key] = value;
    }
  } catch {
    // .env.local is optional.
  }
  return values;
}

function renderTurnConfig(values) {
  const turnUrl = values.VITE_TURN_URL ?? "";
  const parsedTurn = parseTurnUrl(turnUrl);
  const host = values.TURN_HOST ?? parsedTurn.host ?? firstLanIPv4();
  const port = values.TURN_PORT ?? parsedTurn.port ?? "3478";
  const minPort = values.TURN_MIN_PORT ?? "50000";
  const maxPort = values.TURN_MAX_PORT ?? "50100";
  const username = values.VITE_TURN_USERNAME ?? "demo";
  const credential = values.VITE_TURN_CREDENTIAL ?? "demo-password";
  const externalIP = values.TURN_EXTERNAL_IP;

  mkdirSync(".tmp", { recursive: true });
  const path = resolve(".tmp/turnserver.conf");
  writeFileSync(
    path,
    [
      `listening-ip=${host}`,
      `relay-ip=${host}`,
      ...(externalIP ? [`external-ip=${externalIP}/${host}`] : []),
      `listening-port=${port}`,
      `min-port=${minPort}`,
      `max-port=${maxPort}`,
      "fingerprint",
      "lt-cred-mech",
      "realm=demo-meetings.local",
      `user=${username}:${credential}`,
      "no-multicast-peers",
      "no-cli",
      "log-file=stdout",
      "simple-log",
      "",
    ].join("\n"),
  );
  console.log(
    `TURN config: ${externalIP ?? host}:${port} relay-ports=${minPort}-${maxPort} (${path})`,
  );
  return path;
}

function parseTurnUrl(value) {
  const match = value.match(/^turns?:([^:]+)(?::(\d+))?/);
  return {
    host: match?.[1],
    port: match?.[2],
  };
}

function firstLanIPv4() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return "127.0.0.1";
}
