// Keep real alerts grouped by conversation, but re-alert on a new message or
// urgent reminder. NotificationOptions omits the browser's renotify extension.
export function desktopNotificationOptions(
  body: string,
  tag: string,
  urgent = false,
): NotificationOptions & { renotify: boolean } {
  return { body, tag, renotify: true, requireInteraction: urgent };
}

export function createTestDesktopNotification() {
  return {
    title: "اختبار إشعارات لوحة عثمان",
    options: desktopNotificationOptions(
      "هذا إشعار تجريبي جديد من لوحة عثمان.",
      "osman-test-" + crypto.randomUUID(),
    ),
  };
}
