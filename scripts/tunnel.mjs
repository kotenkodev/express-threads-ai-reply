import { env } from "../src/config/env.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const provider = process.argv[2] || env.TUNNEL_PROVIDER;
if (!["cloudflare", "ngrok"].includes(provider)) {
  console.error("Tunnel provider must be cloudflare or ngrok.");
  process.exit(1);
}
const binary = provider === "ngrok" ? "ngrok" : "cloudflared";
const pathVariable = provider === "ngrok" ? "NGROK_PATH" : "CLOUDFLARED_PATH";
const localBinary = fileURLToPath(new URL(
  `../.tools/${binary}${process.platform === "win32" ? ".exe" : ""}`,
  import.meta.url,
));
const executable = env[pathVariable] ||
  (existsSync(localBinary) ? localBinary : binary);

const port = env.PORT;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

const origin = `http://127.0.0.1:${port}`;
console.log(`Opening an HTTPS tunnel to ${origin}. Start the app with npm run dev.`);
console.log(`${provider} prints the public HTTPS URL below. Ctrl+C stops the tunnel.`);

const args = provider === "ngrok" ? ["http", origin] : ["tunnel", "--url", origin];
const tunnel = spawn(executable, args, { stdio: "inherit", windowsHide: true });

tunnel.on("error", (error) => {
  if (error.code === "ENOENT") {
    console.error(`${binary} was not found. Install it using the README instructions, or set ${pathVariable} to its executable.`);
  } else {
    console.error(`Could not start ${binary}: ${error.message}`);
  }
  process.exitCode = 1;
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    tunnel.kill(signal);
  });
}
tunnel.on("exit", (code) => {
  process.exitCode = stopping ? 0 : (code ?? 1);
});
