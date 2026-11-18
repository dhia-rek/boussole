/**
 * Change a Boussole login password from the terminal (input stays hidden).
 *
 *   cd orchestrator && npx tsx scripts/set-password.ts admin
 *
 * Rejects easy passwords, then signs out every session of that user.
 */
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { runWithRequestContext } from "@infra/request-context";
import { revokeAuthSessionsForUser } from "@server/repositories/auth-sessions";
import {
  getUserForLogin,
  updateUserPassword,
} from "@server/repositories/users";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import { passwordProblem } from "./password-policy";

let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding as BufferEncoding);
    callback();
  },
});
const rl = createInterface({ input: process.stdin, output, terminal: true });

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    muted = true;
    rl.question("", (answer) => {
      muted = false;
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const username = (process.argv[2] ?? "").trim();
  if (!username)
    throw new Error("Usage: npx tsx scripts/set-password.ts <username>");
  const user = await getUserForLogin(username);
  if (!user) throw new Error(`No user named "${username}".`);

  const password = await askHidden(`New password for ${username}: `);
  const problem = passwordProblem(password, username);
  if (problem) throw new Error(problem);
  if ((await askHidden("Repeat it: ")) !== password) {
    throw new Error("The two passwords differ. Nothing changed.");
  }

  await updateUserPassword({ id: user.id, password });
  await revokeAuthSessionsForUser(user.id);
  process.stdout.write(
    `Password updated for ${username}; other sessions signed out.\n`,
  );
}

runWithRequestContext({ tenantId: DEFAULT_TENANT_ID }, () => main())
  .then(() => {
    rl.close();
    process.exit(0);
  })
  .catch((error: unknown) => {
    rl.close();
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
