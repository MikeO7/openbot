import { Directory, File } from "expo-file-system";
import type { NotificationAvatar } from "./push-notifications-native.types";

/** `NotificationService.swift` and `OpenBotMessagingService.kt` read this folder and its index. */
const AVATAR_FOLDER = "notification-avatars";
const INDEX_FILE = "index.json";
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Only letters, digits, `-` and `_` go into a file name. The index holds the real IDs. */
function safePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, "_");
}

/**
 * Writes the agent pictures that a notification shows, and an index from `serverId/agentId` to the
 * file. A picture that did not change is not written again. An agent that is gone loses its file.
 */
export function writeAvatarFiles(base: Directory | string, avatars: readonly NotificationAvatar[]): void {
  const folder = new Directory(base, AVATAR_FOLDER);
  folder.create({ intermediates: true, idempotent: true });
  const index: Record<string, string> = {};
  for (const avatar of avatars) {
    const match = /^data:([a-z/]+);base64,(.+)$/u.exec(avatar.dataUrl);
    const extension = match?.[1] ? EXTENSIONS[match[1]] : undefined;
    if (!match?.[2] || !extension) continue;
    const name = `${safePart(avatar.serverId)}-${safePart(avatar.agentId)}-${safePart(avatar.version)}.${extension}`;
    const file = new File(folder, name);
    if (!file.exists) file.writeSync(match[2], { encoding: "base64" });
    index[`${avatar.serverId}/${avatar.agentId}`] = name;
  }
  const kept = new Set([INDEX_FILE, ...Object.values(index)]);
  for (const entry of folder.list()) if (entry instanceof File && !kept.has(entry.name)) entry.delete();
  const text = JSON.stringify({ version: 1, avatars: index });
  const indexFile = new File(folder, INDEX_FILE);
  if (!indexFile.exists || indexFile.textSync() !== text) indexFile.writeSync(text);
}

/** Sign-out removes the pictures with the keys. */
export function removeAvatarFiles(base: Directory | string): void {
  const folder = new Directory(base, AVATAR_FOLDER);
  if (folder.exists) folder.delete();
}
