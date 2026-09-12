// Sole `claude` child-process boundary, shared by MCP capture (SPEC 9.3) and the LLM adapter (SPEC 9.2).
import { spawn } from "node:child_process";
import type { ChildRunWithStdin } from "./agent-session-port";
import { NO_SPAWN_ENV } from "./model-port";

/**
 * Distinguishes an environment refusal from a budget refusal at the call site.
 */
export class SpawnRefusedError extends Error {
  constructor(cmd: string) {
    super(`spawn refused: ${NO_SPAWN_ENV} is set, refusing to run ${cmd}`);
    this.name = "SpawnRefusedError";
  }
}

/**
 * `TOKENLOOM_NO_SPAWN` rejects before spawn regardless of budget state. This last guard keeps a
 * budget-logic regression from launching `claude` during tests.
 */
export const realRun: ChildRunWithStdin = (cmd, args, cwd, stdin) => {
  if (process.env[NO_SPAWN_ENV] !== undefined) return Promise.reject(new SpawnRefusedError(cmd));
  return new Promise((done) => {
    // MCP stdio needs JSON-RPC on stdin, and closing that stream is what ends the one-shot session.
    // A child without input still gets a piped stdin closed at once, which reads the same as no input.
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], cwd });
    // A child that exits without reading stdin fails this write; the run's result is its exit code, not the write.
    child.stdin.on("error", () => undefined);
    child.stdin.end(stdin ?? "", "utf8");
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => { stdout.push(chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr.push(chunk); });
    const output = () => ({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    child.on("error", (e) => { const out = output(); done({ code: -1, ...out, stderr: `${out.stderr}${e.message}` }); });
    child.on("close", (code) => { done({ code: code ?? -1, ...output() }); });
  });
};

export { NO_SPAWN_ENV } from "./model-port";
export type { ChildOutput, ChildRun } from "./model-port";
