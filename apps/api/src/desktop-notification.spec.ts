import {
  createTestDesktopNotification,
  desktopNotificationOptions,
} from "../../web/components/notification-options";

describe("desktop notification repeat behavior", () => {
  it("gives repeated test clicks distinct tags so they do not replace silently", () => {
    const first = createTestDesktopNotification();
    const next = createTestDesktopNotification();
    expect(first.options.tag).not.toEqual(next.options.tag);
    expect(first.options.renotify).toBe(true);
    expect(next.options.renotify).toBe(true);
  });
  it("keeps real conversation grouping while re-alerting on updates", () => {
    const message = desktopNotificationOptions("رسالة جديدة", "conversation");
    const urgent = desktopNotificationOptions("عاجل", "conversation", true);
    expect(message.tag).toBe(urgent.tag);
    expect(message.renotify).toBe(true);
    expect(urgent.renotify).toBe(true);
    expect(urgent.requireInteraction).toBe(true);
  });
});
