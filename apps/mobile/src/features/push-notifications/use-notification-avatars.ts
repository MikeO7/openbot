import { useEffect, useRef } from "react";
import { renderBloubAvatar } from "@/features/live-activity/model/live-activity-bloub";
import type { MobileAgent } from "@/features/workspace/model/workspace-types";
import { pushNotificationsNative as native } from "./push-notifications-native";
import type { NotificationAvatar } from "./push-notifications-native.types";

/** Three pixels for each point of the sender picture that iOS and Android draw, with room to spare. */
const AVATAR_PIXELS = 192;

/** A short, stable name for one picture: the photo address, or the seed and hue of the bloub. */
function avatarVersion(agent: Pick<MobileAgent, "avatarUrl" | "avatarSeed" | "avatarHue">): string {
  const source = agent.avatarUrl ? `photo:${agent.avatarUrl}` : `bloub:${agent.avatarSeed}:${agent.avatarHue ?? ""}`;
  let hash = 5381;
  for (let index = 0; index < source.length; index++) hash = ((hash << 5) + hash + source.charCodeAt(index)) >>> 0;
  return hash.toString(36);
}

/**
 * Keeps a picture of each agent where the notification code of the phone reads it, so a notification
 * shows the agent that sent it. A photo comes through the same query as the agent photo in the app;
 * an agent without one gets its bloub, drawn once. A picture that fails keeps the app icon.
 */
export function useNotificationAvatars(
  agents: readonly MobileAgent[],
  loadAgentAvatar: (agentId: string, avatarUrl: string, serverId: string) => Promise<string>,
): void {
  const written = useRef(new Map<string, NotificationAvatar>());
  const lastSignature = useRef("");
  useEffect(() => {
    const writeAvatars = native?.writeAvatars?.bind(native);
    if (!writeAvatars) return;
    // The agent list changes with each message; the files change only when a picture does.
    const signature = agents.map((agent) => `${agent.serverId}/${agent.id}:${avatarVersion(agent)}`).join("|");
    if (signature === lastSignature.current) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, NotificationAvatar>();
      for (const agent of agents) {
        const key = `${agent.serverId}/${agent.id}`;
        const version = avatarVersion(agent);
        const saved = written.current.get(key);
        if (saved?.version === version) {
          next.set(key, saved);
          continue;
        }
        const dataUrl = agent.avatarUrl
          ? await loadAgentAvatar(agent.id, agent.avatarUrl, agent.serverId).catch(() => null)
          : renderBloubAvatar(agent.avatarSeed, agent.avatarHue, "idle", AVATAR_PIXELS);
        if (cancelled) return;
        if (dataUrl) next.set(key, { serverId: agent.serverId, agentId: agent.id, version, dataUrl });
      }
      if (cancelled) return;
      written.current = next;
      lastSignature.current = signature;
      try {
        writeAvatars([...next.values()]);
      } catch {
        // A notification without its picture shows the app icon, as before.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agents, loadAgentAvatar]);
}
