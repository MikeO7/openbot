import { router } from "expo-router";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import CornerDownRight from "lucide-react-native/icons/corner-down-right";
import TriangleAlert from "lucide-react-native/icons/triangle-alert";
import { memo } from "react";
import { View, type ViewStyle } from "react-native";
import { haptics } from "@/shared/lib/haptics";
import { useText } from "@/shared/lib/text";
import { ChatGlassButton } from "./chat-glass-icon-button";

interface ChatQueueButtonProps {
  chatId: string;
  /** The queued messages, a held edit and the upload that waits to join them. */
  count: number;
  /** The queue failed to load or to change. */
  error: boolean;
  /** The sheet lists teammates that the agent waits for. */
  waiting: boolean;
  liquidGlassAvailable: boolean;
  fallbackBackground: ViewStyle["backgroundColor"];
  /**
   * Steers the first queued message into the running turn, as Steer in the queue sheet does.
   * Absent while no turn runs, when the provider cannot steer, or when that message is locked.
   */
  onSteer?: (() => Promise<boolean>) | undefined;
}

export const ChatQueueButton = memo(function ChatQueueButton({
  chatId,
  count,
  error,
  waiting,
  liquidGlassAvailable,
  fallbackBackground,
  onSteer,
}: ChatQueueButtonProps) {
  const { t } = useText();
  const muted = useThemeColor("muted");
  // A queue that failed to load reports no messages. Keep the entry, so the failure and its
  // retry stay reachable instead of leaving the chat with nothing to press.
  const failed = count === 0 && error;
  // The teammates the agent waits for are not queue rows, but the sheet shows them. Keep the
  // entry for them alone, also before the first answer arrives.
  const onlyReplies = count === 0 && !failed && waiting;
  if (count === 0 && !failed && !onlyReplies) return null;
  const label = failed
    ? t("mobile.chat.queue.unavailable")
    : onlyReplies
      ? t("mobile.chat.queue.repliesTitle")
      : t("mobile.chat.queue.count", { count });
  return (
    <View className="mb-2 flex-row items-center justify-center gap-2">
      <ChatGlassButton
        accessibilityLabel={
          failed
            ? t("mobile.chat.queue.buttonFailed")
            : onlyReplies
              ? label
              : t("mobile.chat.queue.buttonLabel", { count })
        }
        className="h-11 flex-row items-center gap-2 px-4"
        fallbackBackground={fallbackBackground}
        height={44}
        liquidGlassAvailable={liquidGlassAvailable}
        onPress={() => {
          void haptics.selection();
          router.push({ pathname: "/queued-messages", params: { chat: chatId } });
        }}
      >
        {failed ? (
          <TriangleAlert color={String(muted)} size={16} strokeWidth={2} />
        ) : (
          <Clock color={String(muted)} size={16} strokeWidth={2} />
        )}
        <Typography.Paragraph type="body-sm" weight="semibold">
          {label}
        </Typography.Paragraph>
        <ChevronUp color={String(muted)} size={16} strokeWidth={2} />
      </ChatGlassButton>
      {onSteer ? (
        // One tap instead of the queue sheet and the actions sheet, as each queued row on desktop.
        <ChatGlassButton
          accessibilityLabel={t("mobile.chat.queue.steerFirstLabel")}
          className="h-11 flex-row items-center gap-2 px-4"
          fallbackBackground={fallbackBackground}
          height={44}
          liquidGlassAvailable={liquidGlassAvailable}
          onPress={() => {
            void haptics.selection();
            void onSteer().then((done) => haptics.notification(done ? "success" : "error"));
          }}
        >
          <CornerDownRight color={String(muted)} size={16} strokeWidth={2} />
          <Typography.Paragraph type="body-sm" weight="semibold">
            {t("mobile.chat.queue.steer")}
          </Typography.Paragraph>
        </ChatGlassButton>
      ) : null}
    </View>
  );
});
