import fs from "node:fs";
import path from "node:path";
import {
  execFile,
  execFileSync,
  spawnSync,
  type ExecFileOptionsWithStringEncoding,
  type ExecFileSyncOptionsWithStringEncoding,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";

export interface ResolvedCliCommand {
  command: string;
  argsPrefix: string[];
}

interface ResolveCliCommandOptions {
  platform?: NodeJS.Platform;
  pathValue?: string;
  pathExt?: string;
  fileExists?: (candidate: string) => boolean;
}

export function resolveCliCommand(
  command: string,
  options: ResolveCliCommandOptions = {},
): ResolvedCliCommand {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || path.isAbsolute(command)) {
    return { command, argsPrefix: [] };
  }

  const resolved = findCommandOnPath(command, options);
  if (!resolved) {
    return { command, argsPrefix: [] };
  }

  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".cmd" || extension === ".bat") {
    return {
      command: "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", "call", resolved],
    };
  }

  if (extension === ".ps1") {
    return {
      command: "powershell.exe",
      argsPrefix: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolved],
    };
  }

  return { command: resolved, argsPrefix: [] };
}

export function execCliFile(
  command: string,
  args: string[],
  options: ExecFileOptionsWithStringEncoding,
): Promise<{ stdout: string; stderr: string }> {
  const resolved = resolveCliCommand(command);
  return new Promise((resolve, reject) => {
    execFile(
      resolved.command,
      [...resolved.argsPrefix, ...args],
      options,
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

export function execCliFileSync(
  command: string,
  args: string[],
  options: ExecFileSyncOptionsWithStringEncoding,
): string {
  const resolved = resolveCliCommand(command);
  return execFileSync(resolved.command, [...resolved.argsPrefix, ...args], options);
}

export function spawnCliSync(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) {
  const resolved = resolveCliCommand(command);
  return spawnSync(resolved.command, [...resolved.argsPrefix, ...args], options);
}

function findCommandOnPath(
  command: string,
  options: ResolveCliCommandOptions,
): string | undefined {
  const pathValue = options.pathValue ?? process.env.PATH ?? "";
  const pathExt = options.pathExt ?? process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const fileExists = options.fileExists ?? fs.existsSync;
  const extensions = [...pathExt.split(";"), ".PS1"];
  const candidates = extensions.map((ext) => `${command}${ext.toLowerCase()}`);

  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const candidateName of candidates) {
      const candidate = path.join(dir, candidateName);
      if (fileExists(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}
