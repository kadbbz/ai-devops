import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "./git.js";
import { check, Fault, tokenHash } from "./model.js";
export type Snapshot = Record<
  string,
  { data: Buffer; mode: "100644" | "100755" }
>;
export async function readArchive(encoded: string, requiredFile = "agent.md") {
  check(
    /^[A-Za-z0-9+/]+={0,2}$/.test(encoded) &&
      encoded.length <= Math.ceil((32 * 1024 * 1024) / 3) * 4,
    "ARCHIVE_INVALID",
    "压缩包无效或超过 32 MiB",
    400,
  );
  const bytes = Buffer.from(encoded, "base64");
  check(
    bytes.length <= 32 * 1024 * 1024,
    "ARCHIVE_INVALID",
    "压缩包超过 32 MiB",
    400,
  );
  const dir = await mkdtemp(join(tmpdir(), "devops-import-"));
  try {
    await writeFile(join(dir, "archive"), bytes, { mode: 0o600 });
    const { stdout } = await exec(
      "python3",
      [
        fileURLToPath(new URL("./archive.py", import.meta.url)),
        join(dir, "archive"),
        dir,
        requiredFile,
      ],
      { timeout: 60000, maxBuffer: 4 * 1024 * 1024 },
    );
    const files: Snapshot = {};
    for (const item of JSON.parse(stdout))
      files[item.path] = { data: await readFile(item.file), mode: item.mode };
    return {
      files,
      archiveDigest: tokenHash(bytes),
      fileCount: Object.keys(files).length,
      archiveBytes: bytes.length,
    };
  } catch (e) {
    if (e instanceof Fault) throw e;
    throw new Fault(
      "ARCHIVE_INVALID",
      "压缩包无法读取：仅接受安全的 ZIP/TAR（可用 gzip、bzip2、xz 压缩），项目根目录须有非空 agent.md",
      400,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
