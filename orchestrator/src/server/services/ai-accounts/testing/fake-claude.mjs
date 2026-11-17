#!/usr/bin/env node
// Stand-in for the Claude Code CLI in tests: auth login/status/logout and -p.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR || "";
const credentials = configDir ? join(configDir, ".credentials.json") : "";
const readStdin = () =>
  new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (chunk) => {
      data += chunk;
      if (data.includes("\n") && args[0] === "auth") resolve(data);
    });
    process.stdin.on("end", () => resolve(data));
  });

if (args[0] === "--version") {
  console.log("2.1.326 (Claude Code)");
} else if (args[0] === "auth" && args[1] === "login") {
  const url =
    process.env.FAKE_CLAUDE_LOGIN_URL ||
    "https://claude.com/cai/oauth/authorize?code=true&client_id=test";
  console.log("Opening browser to sign in…");
  console.log(`If the browser didn't open, visit: ${url}`);
  process.stdout.write("Paste code here if prompted > ");
  const code = (await readStdin()).trim();
  if (code === "good-code#state") {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      credentials,
      JSON.stringify({
        email: "friend@example.com",
        plan: args.includes("--console") ? "console" : "pro",
      }),
    );
    console.log("Login successful.");
    process.exit(0);
  }
  console.error("OAuth error: invalid code");
  process.exit(1);
} else if (args[0] === "auth" && args[1] === "status") {
  if (!configDir) {
    console.log(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "owner@example.com",
        subscriptionType: "max",
      }),
    );
  } else if (existsSync(credentials)) {
    const saved = JSON.parse(readFileSync(credentials, "utf8"));
    console.log(
      JSON.stringify(
        saved.plan === "console"
          ? { loggedIn: true, authMethod: "console", email: saved.email }
          : {
              loggedIn: true,
              authMethod: "claude.ai",
              email: saved.email,
              subscriptionType: saved.plan,
            },
      ),
    );
  } else {
    console.log(JSON.stringify({ loggedIn: false, authMethod: "none" }));
  }
} else if (args[0] === "auth" && args[1] === "logout") {
  if (credentials) rmSync(credentials, { force: true });
} else if (args[0] === "-p") {
  await readStdin();
  if (configDir && !existsSync(credentials)) {
    console.log("Invalid API key · Please run /login");
    process.exit(1);
  }
  console.log(
    JSON.stringify({
      ok: true,
      configDir: configDir || "server",
      hasServerToken: Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN),
    }),
  );
} else {
  console.error(`fake-claude: unsupported ${args.join(" ")}`);
  process.exit(2);
}
