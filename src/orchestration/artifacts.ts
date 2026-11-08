import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redactSecrets } from "../events";
import type { ArtifactRef } from "./types";

export function contentHash(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** The address describes the bytes actually stored, after credential redaction. */
export function createArtifactStore(directory: string) {
  return {
    async put(content: string, kind: ArtifactRef["kind"] = "blob"): Promise<ArtifactRef> {
      const scanned = redactSecrets(content);
      if (scanned.blocked) throw new Error("artifact contains a private key; storage refused");
      const hash = contentHash(scanned.text);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(join(directory, hash), scanned.text, { flag: "wx", mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      const ref: ArtifactRef = { id: `sha256:${hash}`, kind, hash };
      await this.read(ref); // An existing address is never assumed intact.
      return ref;
    },
    async read(ref: ArtifactRef): Promise<string> {
      if (!ref.hash || !/^[a-f0-9]{64}$/.test(ref.hash) || ref.id !== `sha256:${ref.hash}`) throw new Error("invalid artifact hash/address");
      const bytes = await readFile(join(directory, ref.hash));
      if (contentHash(bytes) !== ref.hash) throw new Error("artifact hash integrity mismatch");
      return bytes.toString("utf8");
    },
  };
}
