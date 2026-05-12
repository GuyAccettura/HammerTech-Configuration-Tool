import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CookieJar, HammerTechClient } from "./http.js";

export async function loadSession(sessionPath) {
  try {
    const raw = await readFile(sessionPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function saveSession(sessionPath, session) {
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

export async function deleteSession(sessionPath) {
  try {
    await unlink(sessionPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function clientFromSession(session, fetchImpl = globalThis.fetch) {
  if (!session?.region) throw new Error("Session file is missing region.");
  return new HammerTechClient({
    region: session.region,
    token: session.token,
    cookieJar: new CookieJar(session.cookies || []),
    fetchImpl
  });
}
