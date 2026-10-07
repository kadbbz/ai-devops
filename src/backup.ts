import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
export function nextBackup(date: Date, time = "03:00", zone = "Asia/Shanghai") {
  const [h, m] = time.split(":").map(Number);
  if (
    !Number.isInteger(h) ||
    !Number.isInteger(m) ||
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  )
    throw new Error("备份时间无效");
  // 按真实时区逐分钟寻找下次时刻，避免把服务器本地时间当计划时区。
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (
    let ms = Math.floor(date.getTime() / 60000) * 60000 + 60000;
    ms <= date.getTime() + 49 * 3600000;
    ms += 60000
  )
    if (format.format(ms) === time) return new Date(ms).toISOString();
  throw new Error("无法计算备份时间");
}
export function retainedBackups(rows: any[]) {
  const good = rows
    .filter((r) => ["COMPLETED", "RESTORE_VERIFIED"].includes(r.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Set<string>();
  const days = new Set<string>(),
    weeks = new Set<number>();
  for (const r of good) {
    const day = r.createdAt.slice(0, 10),
      week = Math.floor(
        (Date.parse(r.createdAt) - 3 * 86400000) / (7 * 86400000),
      );
    if (days.size < 7 && !days.has(day)) {
      days.add(day);
      keep.add(r.id);
    }
    if (weeks.size < 4 && !weeks.has(week)) {
      weeks.add(week);
      keep.add(r.id);
    }
  }
  const upgrade = good.find((r) => r.reason === "upgrade");
  if (upgrade) keep.add(upgrade.id);
  return keep;
}
export function safeArchiveEntry(path: string) {
  return (
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").includes("..") &&
    !path.includes("\0")
  );
}
export async function fileDigest(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
