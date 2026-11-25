"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { io } from "socket.io-client";
import { Chat, Staff, StaffNotification, events } from "@osman/shared";
import { API, api } from "./api";
import {
  createTestDesktopNotification,
  desktopNotificationOptions,
} from "./notification-options";
let audio: AudioContext | undefined;
function sound(urgent: boolean, volume: number) {
  if (!audio || audio.state !== "running") return;
  const now = audio.currentTime;
  for (let i = 0; i < (urgent ? 2 : 1); i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = urgent ? 880 : 660;
    gain.gain.setValueAtTime(0, now + i * 0.22);
    gain.gain.linearRampToValueAtTime(volume * 0.15, now + i * 0.22 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.22 + 0.18);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now + i * 0.22);
    osc.stop(now + i * 0.22 + 0.2);
  }
}
export function Alerts({ onBadge }: { onBadge: (n: number) => void }) {
  const [notices, setNotices] = useState<StaffNotification[]>([]);
  const [hint, setHint] = useState("");
  const [connected, setConnected] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const prefs = useRef<Staff["notifyPrefs"]>({
    sound: true,
    desktop: false,
    volume: 0.5,
  });
  const noticesRef = useRef(notices);
  const seen = useRef(new Set<string>());
  const pathname = usePathname();
  const path = useRef(pathname);
  const router = useRouter();
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);
  useEffect(() => {
    noticesRef.current = notices;
    onBadge(notices.length);
    document.title =
      (notices.length ? "(" + notices.length + ") " : "") + "لوحة عثمان";
  }, [notices, onBadge]);
  useEffect(() => {
    let alive = true;
    let prefsChanged = false;
    const localDesktop = new Map<string, Notification>();
    async function fetchMissed() {
      try {
        const rows = await api<StaffNotification[]>("/notifications");
        if (alive) setNotices(rows);
        for (const n of rows) seen.current.add(n.id);
      } catch {}
    }
    async function markOpen() {
      const id = path.current.match(/^\/chats\/([^/]+)$/)?.[1];
      if (!id || !document.hasFocus() || document.visibilityState !== "visible")
        return;
      await api("/chats/" + id + "/read", { method: "POST" }).catch(() => {});
      if (alive)
        setNotices((rows) => rows.filter((n) => n.conversationId !== id));
      localDesktop.get(id)?.close();
    }
    function present(n: StaffNotification) {
      const urgent = n.type === "urgent";
      if (prefs.current.sound) sound(urgent, prefs.current.volume);
      if (
        prefs.current.desktop &&
        "Notification" in window &&
        Notification.permission === "granted"
      ) {
        try {
          const desktop = new Notification(
            urgent ? "محادثة عاجلة" : "متابعة محادثة",
            desktopNotificationOptions(
              [n.conversation.client.phone, n.conversation.category, n.reason]
                .filter(Boolean)
                .join(" · "),
              n.conversationId,
              urgent,
            ),
          );
          localDesktop.set(n.conversationId, desktop);
          desktop.onerror = () =>
            setHint(
              "تعذر عرض إشعار سطح المكتب؛ تحقق من إعدادات المتصفح والنظام.",
            );
          desktop.onclose = () => {
            if (localDesktop.get(n.conversationId) === desktop)
              localDesktop.delete(n.conversationId);
          };
          desktop.onclick = () => {
            window.focus();
            router.push("/chats/" + n.conversationId);
            desktop.close();
          };
        } catch {
          setHint("تعذر إنشاء إشعار سطح المكتب؛ تحقق من إعدادات المتصفح.");
        }
      }
    }
    function receive(
      payload: {
        conversationId: string;
        notification?: StaffNotification;
      },
      inbound = false,
    ) {
      window.dispatchEvent(new Event("osman:refresh"));
      const n = payload.notification;
      if (!n || seen.current.has(n.id)) return;
      seen.current.add(n.id);
      if (
        path.current === "/chats/" + n.conversationId &&
        document.hasFocus() &&
        document.visibilityState === "visible"
      ) {
        if (!inbound) present(n);
        void markOpen();
        return;
      }
      setNotices((rows) => [n, ...rows.filter((x) => x.id !== n.id)]);
      present(n);
    }
    const socket = io(API, {
      withCredentials: true,
      transports: ["websocket"],
      reconnection: true,
    });
    socket.on("connect", () => {
      setConnected(true);
      window.dispatchEvent(new Event("osman:refresh"));
      void fetchMissed().then(markOpen);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on(events.handoff, (payload) => receive(payload));
    socket.on(events.inbound, (payload) => receive(payload, true));
    socket.on(events.updated, async (payload: { conversationId: string }) => {
      window.dispatchEvent(new Event("osman:refresh"));
      await markOpen();
      try {
        const c = await api<Chat>("/chats/" + payload.conversationId);
        if (c.assignedStaffId || c.status !== "urgent")
          setNotices((rows) =>
            rows.map((n) =>
              n.conversationId === c.id ? { ...n, conversation: c } : n,
            ),
          );
      } catch {}
    });
    socket.on(events.settings, ({ paused }: { paused: boolean }) => {
      window.dispatchEvent(new CustomEvent("osman:paused", { detail: paused }));
      window.dispatchEvent(new Event("osman:settings"));
    });
    api<Staff>("/auth/me")
      .then((u) => {
        if (!prefsChanged) prefs.current = u.notifyPrefs;
      })
      .catch(() => {});
    void fetchMissed();
    const prefHandler = (e: Event) => {
      prefsChanged = true;
      prefs.current = (e as CustomEvent<Staff["notifyPrefs"]>).detail;
    };
    window.addEventListener("osman:prefs", prefHandler);
    async function testDesktop() {
      if (prefs.current.sound) {
        try {
          audio ??= new AudioContext();
          await audio.resume();
          sound(false, prefs.current.volume);
        } catch {
          /* Desktop notifications can still work without audio. */
        }
      }
      if (!("Notification" in window)) {
        setHint("هذا المتصفح لا يدعم إشعارات سطح المكتب.");
        return;
      }
      if (Notification.permission !== "granted") {
        setEnabled(false);
        setHint(
          Notification.permission === "denied"
            ? "إشعارات سطح المكتب محظورة؛ اسمح بها من إعدادات الموقع في المتصفح."
            : "اضغط تفعيل الإشعارات واسمح بإشعارات سطح المكتب أولًا.",
        );
        return;
      }
      if (!prefs.current.desktop) {
        setHint(
          "إشعارات سطح المكتب متوقفة في تفضيلاتك؛ فعّلها من الإعدادات أولًا.",
        );
        return;
      }
      try {
        const { title, options } = createTestDesktopNotification();
        localDesktop.get("__test")?.close();
        const desktop = new Notification(title, options);
        localDesktop.set("__test", desktop);
        desktop.onclick = () => {
          window.focus();
          desktop.close();
        };
        desktop.onclose = () => {
          if (localDesktop.get("__test") === desktop)
            localDesktop.delete("__test");
        };
        desktop.onerror = () =>
          setHint(
            "تعذر عرض الإشعار؛ تحقق من إشعارات Chrome في إعدادات النظام.",
          );
        setEnabled(true);
        setHint("تم إرسال إشعار تجريبي جديد إلى نظام التشغيل.");
      } catch {
        setHint("تعذر إنشاء إشعار سطح المكتب؛ تحقق من إعدادات المتصفح.");
      }
    }
    const test = () => {
      void testDesktop();
    };
    window.addEventListener("focus", markOpen);
    document.addEventListener("visibilitychange", markOpen);
    window.addEventListener("osman:test-notification", test);
    const repeat = setInterval(() => {
      for (const n of noticesRef.current) {
        if (
          n.type !== "urgent" ||
          n.conversation.assignedStaffId ||
          n.conversation.status !== "urgent"
        )
          continue;
        if (path.current === "/chats/" + n.conversationId) {
          void markOpen();
          continue;
        }
        present(n);
      }
    }, 30000);
    return () => {
      alive = false;
      socket.disconnect();
      clearInterval(repeat);
      window.removeEventListener("focus", markOpen);
      document.removeEventListener("visibilitychange", markOpen);
      window.removeEventListener("osman:prefs", prefHandler);
      window.removeEventListener("osman:test-notification", test);
      for (const n of localDesktop.values()) n.close();
    };
  }, [router]);
  useEffect(() => {
    if (pathname.startsWith("/chats/")) {
      const id = pathname.split("/")[2];
      setNotices((rows) => rows.filter((n) => n.conversationId !== id));
    }
  }, [pathname]);
  async function enable() {
    try {
      audio ??= new AudioContext();
      await audio.resume();
      setEnabled(true);
      if ("Notification" in window) {
        const permission = await Notification.requestPermission();
        if (permission === "denied")
          setHint(
            "إشعارات سطح المكتب محظورة؛ اسمح بها من إعدادات الموقع في المتصفح. الصوت متاح أثناء فتح اللوحة.",
          );
        else if (permission === "granted") {
          prefs.current = { ...prefs.current, desktop: true };
          await api("/settings/preferences", {
            method: "PUT",
            body: JSON.stringify(prefs.current),
          });
          setHint("تم تفعيل الإشعارات");
        } else {
          setEnabled(false);
          setHint("لم تُمنح صلاحية سطح المكتب. يمكنك المحاولة مجددًا.");
        }
      } else setHint("المتصفح لا يدعم إشعارات سطح المكتب؛ الصوت متاح.");
      sound(false, prefs.current.volume);
    } catch {
      setHint("تعذر تفعيل الإشعارات؛ تحقق من إعدادات المتصفح.");
    }
  }
  return (
    <div className="noticebar">
      <span className={connected ? "" : "urgent"}>
        {connected ? "متصل" : "جارٍ إعادة الاتصال…"}
      </span>
      {!enabled && (
        <button className="btn" onClick={enable}>
          تفعيل الإشعارات
        </button>
      )}
      {enabled && (
        <button
          className="btn"
          onClick={() => {
            window.dispatchEvent(new Event("osman:test-notification"));
          }}
        >
          اختبار الإشعار
        </button>
      )}
      <small>{hint || "التنبيهات تعمل أثناء فتح تبويب اللوحة فقط."}</small>
      <details>
        <summary>الإشعارات الفائتة ({notices.length})</summary>
        <div className="missed">
          {notices.length ? (
            notices.map((n) => (
              <div key={n.id}>
                <button
                  className="row"
                  onClick={() => router.push("/chats/" + n.conversationId)}
                >
                  <bdi>{n.conversation.client.phone}</bdi> · {n.reason}
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    api("/notifications/" + n.id + "/read", {
                      method: "POST",
                    }).then(() =>
                      setNotices((rows) => rows.filter((x) => x.id !== n.id)),
                    )
                  }
                >
                  تحديد كمقروء
                </button>
              </div>
            ))
          ) : (
            <p>لا توجد إشعارات فائتة</p>
          )}
        </div>
      </details>
    </div>
  );
}
