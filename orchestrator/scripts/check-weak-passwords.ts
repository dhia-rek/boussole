/**
 * Exit 1 when any active account still uses an easy password (for example
 * "admin"/"admin"). scripts/share.sh runs this before opening a tunnel.
 */
import { runWithRequestContext } from "@infra/request-context";
import { verifyPassword } from "@server/auth/password";
import { db, schema } from "@server/db";
import { DEFAULT_TENANT_ID } from "@server/tenancy/constants";
import { EASY_PASSWORDS } from "./password-policy";

async function main(): Promise<number> {
  const users = await db
    .select({
      username: schema.users.username,
      passwordHash: schema.users.passwordHash,
      passwordSalt: schema.users.passwordSalt,
      isDisabled: schema.users.isDisabled,
    })
    .from(schema.users);

  const weak: string[] = [];
  for (const user of users) {
    if (user.isDisabled) continue;
    for (const candidate of [user.username, ...EASY_PASSWORDS]) {
      if (
        await verifyPassword({
          password: candidate,
          passwordHash: user.passwordHash,
          passwordSalt: user.passwordSalt,
        })
      ) {
        weak.push(user.username);
        break;
      }
    }
  }

  if (weak.length === 0) {
    process.stdout.write("Passwords look fine.\n");
    return 0;
  }
  process.stderr.write(
    `These accounts use an easy password: ${weak.join(", ")}.\n` +
      "Change it before going online:\n" +
      weak
        .map((name) => `  npx tsx scripts/set-password.ts ${name}\n`)
        .join(""),
  );
  return 1;
}

runWithRequestContext({ tenantId: DEFAULT_TENANT_ID }, () => main())
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  });
