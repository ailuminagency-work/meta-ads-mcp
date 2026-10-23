import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function materializeGoogleCredentials(env: NodeJS.ProcessEnv = process.env): () => void {
  const raw = env.GOOGLE_CREDENTIALS_JSON;
  const configuredPath = env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (!raw) {
    if (configuredPath && (/^https?:\/\//i.test(configuredPath) || /\.(?:exe|cmd|bat|ps1)$/i.test(configuredPath))) {
      throw new Error("Google credential source must be a local credential file");
    }
    return () => {};
  }
  if (configuredPath) throw new Error("Configure one Google credential source only");
  let parsed: { type?: unknown; project_id?: unknown; client_email?: unknown; private_key?: unknown };
  try { parsed = JSON.parse(raw) as { type?: unknown }; }
  catch { throw new Error("GOOGLE_CREDENTIALS_JSON must be valid credential JSON"); }
  if (!parsed || parsed.type !== "service_account") throw new Error("Google credentials must use service_account type");
  const expectedProject = env.LUMIN_EXPECTED_FIRESTORE_PROJECT_ID?.trim();
  if (expectedProject && parsed.project_id !== expectedProject) throw new Error("Google credential project is not approved");
  const expectedEmail = env.LUMIN_EXPECTED_GOOGLE_SERVICE_ACCOUNT?.trim();
  if (expectedEmail && parsed.client_email !== expectedEmail) throw new Error("Google credential identity is not approved");
  if (typeof parsed.client_email !== "string" || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(parsed.client_email)) throw new Error("Google credential service account identity is invalid");
  if (typeof parsed.private_key !== "string" || !parsed.private_key.includes("BEGIN PRIVATE KEY")) throw new Error("Google service account private key is invalid");
  const directory = mkdtempSync(path.join(tmpdir(), "lumin-google-"));
  const file = path.join(directory, "credentials.json");
  writeFileSync(file, raw, { mode: 0o600, flag: "wx" });
  env.GOOGLE_APPLICATION_CREDENTIALS = file;
  delete env.GOOGLE_CREDENTIALS_JSON;
  return () => { rmSync(directory, { recursive: true, force: true }); };
}
