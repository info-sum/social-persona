let verboseEnabled = false;

export function setVerbose(v: boolean): void {
  verboseEnabled = v;
}

export function isVerbose(): boolean {
  return verboseEnabled;
}

export function info(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export function step(msg: string): void {
  process.stderr.write(`→ ${msg}\n`);
}

export function ok(msg: string): void {
  process.stderr.write(`✓ ${msg}\n`);
}

export function warn(msg: string): void {
  process.stderr.write(`! ${msg}\n`);
}

export function fail(msg: string): void {
  process.stderr.write(`✗ ${msg}\n`);
}

export function debug(msg: string): void {
  if (verboseEnabled) process.stderr.write(`  · ${msg}\n`);
}
