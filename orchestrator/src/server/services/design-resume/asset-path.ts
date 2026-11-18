import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { getDataDir } from "@server/config/dataDir";

/**
 * A CV picture's file on disk. Paths are saved absolute, so moving or
 * renaming the data folder (or restoring a backup elsewhere) would lose
 * them: when the saved path is gone, use the same file name in today's
 * asset folder.
 */
export function resolveDesignResumeAssetPath(storagePath: string): string {
  if (existsSync(storagePath)) return storagePath;
  const relocated = join(
    getDataDir(),
    "design-resume",
    "assets",
    basename(storagePath),
  );
  return existsSync(relocated) ? relocated : storagePath;
}
