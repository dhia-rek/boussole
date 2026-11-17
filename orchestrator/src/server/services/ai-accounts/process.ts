import { spawn } from "node:child_process";

export type CliRunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type CliSpawnFn = typeof spawn;

const MAX_CAPTURE_BYTES = 2_000_000;

/** Runs a CLI to completion with a timeout; output is capped in memory. */
export function runCli(
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    input?: string;
    timeoutMs: number;
    signal?: AbortSignal;
    spawnFn?: CliSpawnFn;
  },
): Promise<CliRunResult> {
  const spawnFn = options.spawnFn ?? spawn;
  return new Promise((resolve, reject) => {
    let child: ReturnType<CliSpawnFn>;
    try {
      child = spawnFn(command, args, {
        env: options.env,
        cwd: options.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const append = (current: string, chunk: Buffer | string) => {
      const next =
        current + (typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return next.length > MAX_CAPTURE_BYTES
        ? next.slice(-MAX_CAPTURE_BYTES)
        : next;
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref();
    }, options.timeoutMs);
    timer.unref();

    const onAbort = () => child.kill("SIGTERM");
    options.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr, timedOut });
    });

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    } else {
      child.stdin?.end();
    }
  });
}

/** Removes terminal colour/cursor codes from CLI output. */
export function stripAnsi(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes
  return value.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** Last non-empty lines of CLI output, for short error messages. */
export function lastLines(text: string, count = 3): string {
  return stripAnsi(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(" ");
}
