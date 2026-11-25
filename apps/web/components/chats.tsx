"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Chat,
  ConversationMachine,
  ConversationStatus,
  OfficeConfig,
  Staff,
  StaffAction,
  statusLabels,
} from "@osman/shared";
import { api } from "./api";
import { Shell, Toast } from "./shell";
const tabs: [ConversationStatus | "all", string][] = [
  ["all", "الكل"],
  ["urgent", "عاجل"],
  ["human", "عند موظف"],
  ["waiting_schedule", "بانتظار الموعد"],
  ["not_suitable", "غير مناسب"],
];
const colors = {
  agent_active: "g",
  human: "h",
  urgent: "u",
  waiting_schedule: "w",
  not_suitable: "x",
};
const time = (at: string) =>
  new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(at));
function relative(at: string) {
  const m = Math.max(
    0,
    Math.floor((Date.now() - new Date(at).getTime()) / 60000),
  );
  return new Intl.RelativeTimeFormat("ar-u-nu-latn", {
    numeric: "auto",
  }).format(
    m < 60 ? -m : m < 1440 ? -Math.floor(m / 60) : -Math.floor(m / 1440),
    m < 60 ? "minute" : m < 1440 ? "hour" : "day",
  );
}
export function Chats({ selectedId }: { selectedId?: string }) {
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [chat, setChat] = useState<Chat>();
  const [tab, setTab] = useState<ConversationStatus | "all">("all");
  const [settings, setSettings] = useState<OfficeConfig>();
  const [user, setUser] = useState<Staff>();
  const [text, setText] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [secretaryUrl, setSecretaryUrl] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  const bottom = useRef(true);
  const currentId = useRef(selectedId);
  const say = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 5000);
  }, []);
  const refresh = useCallback(async () => {
    try {
      setChats(await api<Chat[]>("/chats"));
      setLoaded(true);
      if (selectedId) {
        const detail = await api<Chat>("/chats/" + selectedId);
        if (currentId.current === selectedId) setChat(detail);
      }
    } catch (e) {
      say((e as Error).message);
    }
  }, [selectedId, say]);
  useEffect(() => {
    currentId.current = selectedId;
    setChat(undefined);
    bottom.current = true;
    setText("");
    setSecretaryUrl("");
    void refresh();
    if (selectedId)
      api("/chats/" + selectedId + "/read", { method: "POST" })
        .then(() => refresh())
        .catch((e) => say(e.message));
  }, [selectedId, refresh, say]);
  useEffect(() => {
    api<OfficeConfig>("/settings")
      .then(setSettings)
      .catch((e) => say(e.message));
    api<Staff>("/auth/me")
      .then(setUser)
      .catch(() => {});
  }, [say]);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 10000);
    const handler = () => void refresh();
    window.addEventListener("osman:refresh", handler);
    return () => {
      clearInterval(timer);
      window.removeEventListener("osman:refresh", handler);
    };
  }, [refresh]);
  useEffect(() => {
    if (bottom.current && thread.current)
      thread.current.scrollTop = thread.current.scrollHeight;
  }, [chat?.messages.length, selectedId]);
  async function action(kind: StaffAction) {
    if (!chat || busy) return;
    if (
      kind === "close" &&
      !confirm("هل تريد إغلاق المحادثة باعتبارها غير مناسبة؟")
    )
      return;
    if (kind === "secretary" && !settings?.contacts.secretary) {
      say("أضف رقم واتساب السكرتيرة في الإعدادات أولًا");
      return;
    }
    const popup =
      kind === "secretary" ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    setBusy(true);
    try {
      const result = await api<{ link?: string }>(
        "/chats/" + chat.id + "/actions",
        {
          method: "POST",
          body: JSON.stringify({ action: kind, version: chat.version }),
        },
      );
      if (result.link) {
        setSecretaryUrl(result.link);
        if (popup) popup.location.href = result.link;
      }
      say("تم تحديث المحادثة");
      await refresh();
    } catch (e) {
      popup?.close();
      say((e as Error).message);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  const windowOpen = chat
    ? ConversationMachine.canCompose(chat.status, chat.lastClientMessageAt)
    : false;
  const canSend = windowOpen && chat?.assignedStaffId === user?.id;
  return (
    <Shell>
      <section className="view on">
        <div className="cg">
          <section className="pn col" aria-label="قائمة المحادثات">
            <div className="tabs" role="tablist" aria-label="حالة المحادثات">
              {tabs.map(([key, label], i) => (
                <button
                  id={"tab-" + key}
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  aria-controls="chat-list"
                  tabIndex={tab === key ? 0 : -1}
                  className={"tb " + (tab === key ? "on" : "")}
                  onClick={() => setTab(key)}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const n =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? tabs.length - 1
                            : (i +
                                (e.key === "ArrowLeft" ? 1 : -1) +
                                tabs.length) %
                              tabs.length;
                      setTab(tabs[n][0]);
                      document.getElementById("tab-" + tabs[n][0])?.focus();
                    }
                  }}
                >
                  {label}
                  <sup>
                    {
                      chats.filter((c) => key === "all" || c.status === key)
                        .length
                    }
                  </sup>
                </button>
              ))}
            </div>
            <div
              className="ls"
              id="chat-list"
              role="tabpanel"
              aria-labelledby={"tab-" + tab}
            >
              {chats
                .filter((c) => tab === "all" || c.status === tab)
                .map((c) => (
                  <button
                    className={"row " + (selectedId === c.id ? "on" : "")}
                    aria-pressed={selectedId === c.id}
                    key={c.id}
                    onClick={() => router.push("/chats/" + c.id)}
                  >
                    <div>
                      <b>{c.client.name || <bdi>{c.client.phone}</bdi>}</b>
                      <small>{relative(c.lastActivityAt)}</small>
                    </div>
                    <span className="s">
                      {c.messages[0]?.text || "لا توجد رسائل"}
                    </span>
                    <div>
                      <span className={"k " + colors[c.status]}>
                        {statusLabels[c.status]}
                      </span>
                      {c.unreadCount > 0 && (
                        <span
                          className="unread"
                          aria-label={c.unreadCount + " رسائل غير مقروءة"}
                        >
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              {!chats.some((c) => tab === "all" || c.status === tab) && (
                <p className="empty">
                  {loaded ? "لا توجد محادثات" : "جارٍ تحميل المحادثات…"}
                </p>
              )}
            </div>
          </section>
          <section className="pn col" aria-label="المحادثة">
            {chat ? (
              <>
                <header className="ch">
                  <div>
                    <b>{chat.client.name || <bdi>{chat.client.phone}</bdi>}</b>
                    <div>
                      <bdi className="ltr">{chat.client.phone}</bdi> ·{" "}
                      <span className={"k " + colors[chat.status]}>
                        {statusLabels[chat.status]}
                      </span>
                    </div>
                  </div>
                  <small>{chat.assignedStaff?.name}</small>
                </header>
                <div
                  className="ms"
                  ref={thread}
                  onScroll={() => {
                    const el = thread.current;
                    bottom.current =
                      !!el &&
                      el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  }}
                >
                  {chat.messages.map((m) => (
                    <article
                      className={
                        "m " +
                        (m.direction === "client"
                          ? "c"
                          : m.direction === "agent"
                            ? "b"
                            : "staff")
                      }
                      key={m.id}
                    >
                      <small>
                        {m.direction === "client"
                          ? "العميل"
                          : m.direction === "agent"
                            ? "عثمان"
                            : "الفريق"}
                      </small>
                      <div className="message-text">{m.text}</div>
                      <small>
                        <time dateTime={m.createdAt}>{time(m.createdAt)}</time>
                        {m.direction !== "client" &&
                          " · " +
                            ({
                              sent: "أُرسلت",
                              delivered: "تم التسليم",
                              read: "قُرئت",
                              failed: "فشل الإرسال",
                              pending: "قيد الإرسال",
                            }[m.deliveryStatus] || "قيد الإرسال")}
                      </small>
                    </article>
                  ))}
                </div>
                <form
                  className="in"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!text.trim() || !canSend || busy) return;
                    setBusy(true);
                    try {
                      await api("/chats/" + chat.id + "/messages", {
                        method: "POST",
                        body: JSON.stringify({
                          text: text.trim(),
                          version: chat.version,
                        }),
                      });
                      setText("");
                      bottom.current = true;
                      await refresh();
                    } catch (e) {
                      say((e as Error).message);
                      await refresh();
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <input
                    aria-label="الرسالة"
                    placeholder="اكتب رسالتك…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={!canSend || busy}
                    maxLength={4096}
                  />
                  <button
                    className="btn p"
                    disabled={!canSend || busy || !text.trim()}
                  >
                    إرسال
                  </button>
                </form>
                {!canSend && (
                  <p className="hint">
                    {(chat.status === "human" || chat.status === "urgent") &&
                    !windowOpen
                      ? "انتهت نافذة خدمة العملاء البالغة 24 ساعة؛ يلزم إرسال رسالة قالب (غير متاح حاليًا)."
                      : chat.assignedStaffId &&
                          chat.assignedStaffId !== user?.id
                        ? "المحادثة عند " + chat.assignedStaff?.name
                        : "اضغط تحويل إلى موظف لاستلام المحادثة"}
                  </p>
                )}
              </>
            ) : (
              <p className="empty">
                {selectedId
                  ? "جارٍ تحميل المحادثة…"
                  : "اختر محادثة لعرض الرسائل"}
              </p>
            )}
          </section>
          <aside className="pn col" aria-label="إجراءات المحادثة وملخص الفريق">
            <div className="ph">إجراءات المحادثة</div>
            <div className="ac">
              {(
                [
                  ["take", "تحويل إلى موظف", "p"],
                  ["resume", "إعادة إلى عثمان", ""],
                  ["secretary", "تحويل إلى السكرتيرة (واتساب)", "wa"],
                  ["close", "إغلاق: غير مناسب", "danger"],
                ] as const
              ).map(([key, label, cls]) => (
                <button
                  key={key}
                  className={"btn " + cls}
                  disabled={!chat || busy}
                  onClick={() => action(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="hint">
              يفتح واتساب برسالة جاهزة؛ راجعها ثم أرسلها إلى السكرتيرة.
              {!settings?.contacts.secretary && (
                <>
                  {" "}
                  <Link href="/settings">أضف رقم السكرتيرة في الإعدادات</Link>.
                </>
              )}
              {secretaryUrl && (
                <>
                  {" "}
                  <a
                    href={secretaryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    فتح رسالة السكرتيرة
                  </a>
                </>
              )}
            </p>
            <div className="ph">ملخص الفريق</div>
            <p className="sm message-text">
              {chat?.summary || "لم يُضف ملخص بعد"}
            </p>
            {chat?.urgentReason && (
              <p className="hint urgent">{chat.urgentReason}</p>
            )}
            <div className="kv">
              <div>
                <span>الاسم</span>
                <b>{chat?.client.name || "غير محدد"}</b>
              </div>
              <div>
                <span>الهاتف</span>
                <bdi>{chat?.client.phone || "—"}</bdi>
              </div>
              <div>
                <span>تصنيف القضية</span>
                <b>
                  {chat?.category ||
                    chat?.client.detectedCategory ||
                    "غير محدد"}
                </b>
              </div>
              <div>
                <span>رقم السكرتيرة</span>
                <bdi>{settings?.contacts.secretary || "غير محدد"}</bdi>
              </div>
            </div>
          </aside>
        </div>
      </section>
      <Toast message={toast} />
    </Shell>
  );
}
