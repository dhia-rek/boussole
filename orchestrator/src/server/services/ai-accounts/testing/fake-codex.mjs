#!/usr/bin/env node
// Stand-in for the Codex CLI in tests: login --device-auth/status, logout, exec, debug models.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const home = process.env.CODEX_HOME || "";
const auth = home ? join(home, "auth.json") : "";
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

if (args[0] === "--version") {
  console.log("codex-cli 0.169.0");
} else if (args[0] === "login" && args[1] === "status") {
  console.log(existsSync(auth) ? "Logged in using ChatGPT" : "Not logged in");
} else if (args[0] === "login" && args.includes("--device-auth")) {
  if (process.env.FAKE_CODEX_DEVICE_DISABLED === "1") {
    console.error(
      "Error: enable device code authorization in your ChatGPT security settings",
    );
    process.exit(1);
  }
  console.log(
    "Follow these steps to sign in with ChatGPT using device code authorization:",
  );
  console.log("1. Open this link in your browser and sign in to your account");
  console.log("   https://auth.openai.com/codex/device");
  console.log("2. Enter this one-time code (expires in 15 minutes)");
  console.log("   ABCD-12345");
  setTimeout(
    () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(auth, JSON.stringify({ auth_mode: "chatgpt" }));
      console.log("Successfully logged in");
      process.exit(0);
    },
    Number(process.env.FAKE_CODEX_APPROVE_AFTER_MS || 300),
  );
} else if (args[0] === "logout") {
  if (auth) rmSync(auth, { force: true });
  console.log("Successfully logged out");
} else if (args[0] === "exec") {
  let prompt = "";
  process.stdin.on("data", (chunk) => {
    prompt += chunk;
  });
  process.stdin.on("end", () => {
    if (!existsSync(auth)) {
      console.error("Error: Not logged in. Run codex login.");
      process.exit(1);
    }
    const out = valueAfter("-o");
    writeFileSync(
      out,
      JSON.stringify({
        ok: true,
        codexHome: home,
        hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
        model: valueAfter("-m") ?? null,
        sandbox: valueAfter("--sandbox") ?? null,
        promptChars: prompt.length,
      }),
    );
  });
} else if (args[0] === "debug" && args[1] === "models") {
  console.log(
    JSON.stringify({
      models: [
        {
          slug: "gpt-hidden",
          display_name: "Hidden",
          visibility: "hide",
          priority: 0,
        },
        {
          slug: "gpt-b",
          display_name: "Model B",
          description: "Second",
          visibility: "list",
          priority: 2,
          default_reasoning_level: "low",
          supported_reasoning_levels: [{ effort: "low", description: "Fast" }],
        },
        {
          slug: "gpt-a",
          display_name: "Model A",
          description: "First",
          visibility: "list",
          priority: 1,
          default_reasoning_level: "medium",
          supported_reasoning_levels: [
            { effort: "medium", description: "Balanced" },
            { effort: "high", description: "Deep" },
          ],
        },
      ],
    }),
  );
} else {
  console.error(`fake-codex: unsupported ${args.join(" ")}`);
  process.exit(2);
}
