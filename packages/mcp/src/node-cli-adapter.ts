import { spawnSync } from "node:child_process";
import type { RunCli } from "./cli-port";

export function nodeCli(cliPath: string, cwd: string): RunCli {
  return (argv) => {
    const result = spawnSync(process.execPath, [cliPath, ...argv], { cwd, encoding: "utf8" });
    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  };
}
