let verbose = false;

export function setVerbose(v) { verbose = v; }
export function isVerbose() { return verbose; }

// verbose 关时静默，开时打到 stderr
export function debug(msg) {
  if (verbose) process.stderr.write(`[debug] ${msg}\n`);
}
