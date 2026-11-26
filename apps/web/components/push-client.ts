"use client";
import { api } from "./api";
import { getFirebaseMessaging } from "./firebase";
import type { MessagePayload } from "firebase/messaging";

const storageKey = "osman.push.registration";
let enrollment: Promise<string> | undefined;
export function currentPushRegistration() {
  try {
    return localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
function deadline<T>(
  promise: Promise<T>,
  message: string,
  milliseconds = 20000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}
export function enableFirebasePush(): Promise<string> {
  if (enrollment) return enrollment;
  enrollment = (async () => {
    if (!window.isSecureContext || !("serviceWorker" in navigator))
      throw new Error("إشعارات الخلفية تحتاج متصفحًا مدعومًا واتصالًا آمنًا");
    if (!("Notification" in window) || Notification.permission !== "granted")
      throw new Error("اسمح بإشعارات سطح المكتب أولًا");
    const status = await api<{ configured: boolean }>("/push/status");
    if (!status.configured)
      throw new Error("إعداد إشعارات الخلفية في الخادم غير مكتمل");
    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) throw new Error("مفتاح إشعارات الخلفية غير مُعدّ");
    const messaging = await getFirebaseMessaging();
    if (!messaging)
      throw new Error("المتصفح لا يدعم إشعارات Firebase أو الإعداد غير مكتمل");
    const registration = await navigator.serviceWorker.register(
      "/firebase-messaging-sw.js",
      { scope: "/" },
    );
    await deadline(
      navigator.serviceWorker.ready,
      "تعذر بدء خدمة إشعارات الخلفية",
    );
    const { register, onRegistered } = await import("firebase/messaging");
    let stop: () => void = () => {};
    const registered = new Promise<string>((resolve, reject) => {
      stop = onRegistered(messaging, (fid) => {
        void api<{ id: string }>("/push/registrations", {
          method: "POST",
          body: JSON.stringify({ fid }),
        })
          .then((record) => {
            try {
              localStorage.setItem(storageKey, record.id);
            } catch {}
            resolve(record.id);
          })
          .catch(reject);
      });
      void register(messaging, {
        vapidKey,
        serviceWorkerRegistration: registration,
      }).catch(reject);
    });
    try {
      return await deadline(registered, "لم يكتمل تسجيل المتصفح في Firebase");
    } finally {
      stop();
    }
  })()
    .catch((error) => {
      throw new Error(
        error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
          ? error.message
          : "تعذر تفعيل إشعارات الخلفية؛ تحقق من اتصال Firebase ومفتاح Web Push",
      );
    })
    .finally(() => {
      enrollment = undefined;
    });
  return enrollment;
}
export async function listenFirebaseMessages(
  callback: (payload: MessagePayload) => void,
) {
  const messaging = await getFirebaseMessaging();
  if (!messaging) return () => {};
  const { onMessage } = await import("firebase/messaging");
  return onMessage(messaging, callback);
}
export async function removeFirebasePush() {
  const id = currentPushRegistration();
  if (id)
    await api("/push/registrations/" + encodeURIComponent(id), {
      method: "DELETE",
    });
  try {
    localStorage.removeItem(storageKey);
  } catch {}
  const messaging = await getFirebaseMessaging();
  if (messaging) {
    const { unregister } = await import("firebase/messaging");
    await unregister(messaging);
  }
}
