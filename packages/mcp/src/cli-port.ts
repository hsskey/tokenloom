export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
}

export type RunCli = (argv: string[]) => CliRun;
