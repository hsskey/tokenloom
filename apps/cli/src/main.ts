import { EXIT, parseArgs, usageError } from "./args";
import { cmdTokensBuild } from "./cmd-tokens";
import { cmdDoctor, collectAllWarnings } from "./cmd-doctor";
import { cmdContext } from "./cmd-context";
import { cmdEvalRun, cmdEvalReport } from "./cmd-eval";
import { cmdSnapshotImport } from "./cmd-snapshot";
import { cmdBudget, cmdSamplesDiff, cmdSamplesRefresh, cmdSync } from "./cmd-sync";
import { cmdEvalCapture } from "./cmd-capture";
import { cmdEvalTrajectory } from "./cmd-trajectory";
import { cmdInit } from "./cmd-init";

const USAGE = `tokenloom <command>

  tokens build --from <a.json[,b.json]> [--out dist/tokens] [--platform css] [--strict] [--json]
  context <componentName> [--node <id>] --from <a.json[,b.json]> [--level compact|full]
          [--view canonical|agent] [--variant=<key=value,...>] [--annotations] [--json] [--strict]
  context --from <a.json[,b.json]> --view agent [--match <text>]
          List the component sets in the snapshot instead of one component context.
          Put -- before a component name that begins with --.
  doctor       --from <a.json[,b.json]> [--strict] [--json]
  init         [--project <directory>] [--update]
          Install the tokenloom Agent Skill into an application project.
  eval run     --matrix <yaml> [--parallel 6] [--budget-usd N] [--json]
  eval report  --out reports/<date>.md [--since <date>] [--json]
  eval trajectory --matrix <yaml> [--budget-usd N] [--dry-run] [--json]
  snapshot import <export.json> --into <sample-directory> [--expect-exporter <sha>] [--plan <plan>] [--file-key <key>]
  eval capture --input mcp --node <id> [--json]
  sync         --file <fileKey> [--sets <name,...>] [--json]
  budget       [--json]
  samples refresh --file <fileKey> --only <name>
  samples diff    --only <name> [--against <snapshot.json>] [--json]
`;

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  const [command, sub] = parsed.positional;
  if (parsed.unknownOptions.length > 0) {
    return usageError(`unknown option --${parsed.unknownOptions.sort().join(", --")}`);
  }
  // An explicit --help is a successful request, so it answers on stdout and can be piped or saved.
  if (parsed.flags.help !== undefined) {
    process.stdout.write(USAGE);
    return EXIT.ok;
  }
  if (command === undefined) {
    process.stderr.write(USAGE);
    return EXIT.fatal;
  }
  if (command === "tokens" && sub === "build") return cmdTokensBuild(parsed);
  if (command === "context") return cmdContext(parsed);
  if (command === "doctor") return cmdDoctor(parsed, collectAllWarnings);
  if (command === "init") return cmdInit(parsed);
  if (command === "eval" && sub === "run") return cmdEvalRun(parsed);
  if (command === "eval" && sub === "report") return cmdEvalReport(parsed);
  if (command === "eval" && sub === "trajectory") return cmdEvalTrajectory(parsed);
  if (command === "snapshot" && sub === "import") return cmdSnapshotImport(parsed);
  if (command === "eval" && sub === "capture") return cmdEvalCapture(parsed);
  if (command === "sync") return cmdSync(parsed);
  if (command === "budget") return cmdBudget(parsed);
  if (command === "samples" && sub === "refresh") return cmdSamplesRefresh(parsed);
  if (command === "samples" && sub === "diff") return cmdSamplesDiff(parsed);
  return usageError(`unknown command "${[command, sub].filter((s) => s !== undefined).join(" ")}"`);
}

async function main(): Promise<void> {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`tokenloom: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = EXIT.fatal;
  }
}

await main();
