"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
type Session = {
  provider: string;
  state:
    | "connected"
    | "connecting"
    | "disconnected"
    | "unavailable"
    | "unconfigured"
    | "not_applicable";
  qr: string | null;
  expiresAt: string | null;
};
const labels: Record<Session["state"], string> = {
  connected: "واتساب متصل",
  connecting: "جارٍ ربط واتساب",
  disconnected: "واتساب غير متصل",
  unavailable: "تعذر الوصول إلى موصل واتساب",
  unconfigured: "إعداد موصل واتساب غير مكتمل",
  not_applicable: "الربط برمز QR غير مستخدم في هذا الوضع",
};
export function WhatsAppConnection({
  admin,
  say,
}: {
  admin: boolean;
  say: (message: string) => void;
}) {
  const [session, setSession] = useState<Session>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true,
      pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<Session>("/whatsapp/status");
        if (active) setSession(result);
      } catch {
        if (active)
          setSession({
            provider: "evolution",
            state: "unavailable",
            qr: null,
            expiresAt: null,
          });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [admin]);
  const validQr =
    admin &&
    session?.qr &&
    session.expiresAt &&
    new Date(session.expiresAt).getTime() > now;
  return (
    <section className="pn" aria-labelledby="whatsapp-title">
      <h2 className="ph whatsapp-heading" id="whatsapp-title">
        ربط واتساب المكتب
      </h2>
      <div className="f">
        <p role="status" aria-live="polite">
          {session ? labels[session.state] : "جارٍ التحقق من اتصال واتساب…"}
        </p>
        <p className="hint">
          يبقى الرقم متصلًا بعد إغلاق اللوحة. رمز الربط متاح للمدير فقط ولا يظهر
          في صفحة تسجيل الدخول.
        </p>
        {validQr && (
          <div className="whatsapp-qr">
            {/* Only authenticated, server-validated PNG data URLs are accepted. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={session!.qr!}
              alt="رمز ربط واتساب المكتب"
              width={280}
              height={280}
            />
            <p>
              افتح واتساب للأعمال في هاتف المكتب ← الأجهزة المرتبطة ← ربط جهاز،
              ثم امسح الرمز. يتجدد الرمز تلقائيًا أثناء الربط.
            </p>
          </div>
        )}
        {admin &&
          session?.provider === "evolution" &&
          session.state !== "connected" && (
            <button
              type="button"
              className="btn p"
              disabled={busy || session.state === "unconfigured"}
              onClick={async () => {
                setBusy(true);
                try {
                  setSession(
                    await api<Session>("/whatsapp/connect", { method: "POST" }),
                  );
                  setNow(Date.now());
                  say("تم طلب ربط واتساب؛ امسح الرمز من هاتف المكتب عند ظهوره");
                } catch (error) {
                  say((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "جارٍ تجهيز الرمز…" : "ربط واتساب / تحديث الرمز"}
            </button>
          )}
        {session?.state === "connecting" && !validQr && (
          <p className="hint">
            في انتظار رمز جديد أو تأكيد الهاتف. إذا طال الانتظار، اطلب تحديث
            الرمز.
          </p>
        )}
        {!admin && session?.state !== "connected" && (
          <p className="hint">يرجى التواصل مع المدير لربط رقم المكتب.</p>
        )}
      </div>
    </section>
  );
}
