"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { OfficeConfig, Staff } from "@osman/shared";
import { api } from "./api";
import { Alerts } from "./alerts";
export function Shell({ children }: { children: React.ReactNode }) {
  const [badge, setBadge] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState<Staff>();
  const [paused, setPaused] = useState(false);
  const pathname = usePathname();
  useEffect(() => {
    setCollapsed(window.innerWidth <= 760);
    api<Staff>("/auth/me")
      .then(setUser)
      .catch(() => {});
    api<OfficeConfig>("/settings")
      .then((s) => setPaused(s.rules.paused))
      .catch(() => {});
    const handler = (e: Event) => setPaused((e as CustomEvent<boolean>).detail);
    window.addEventListener("osman:paused", handler);
    return () => window.removeEventListener("osman:paused", handler);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("sbc", collapsed);
    return () => document.body.classList.remove("sbc");
  }, [collapsed]);
  return (
    <div className="app">
      <aside id="sidebar" className="sb" aria-label="القائمة الرئيسية">
        <div className="sh">
          <div className="mono">ع</div>
          <div className="bt">
            <b>لوحة عثمان</b>
            <small>آل عثمان محامون ومستشارون</small>
          </div>
          <button
            className="ib"
            aria-label={collapsed ? "توسيع القائمة" : "طي القائمة"}
            aria-expanded={!collapsed}
            aria-controls="sidebar"
            onClick={() => setCollapsed(!collapsed)}
          >
            <svg
              className="chev"
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 3l6 6-6 6" />
            </svg>
          </button>
        </div>
        <nav>
          {[
            ["/chats", "المحادثات", "◫"],
            ["/settings", "الإعدادات", "⚙"],
          ].map(([href, label, icon]) => (
            <Link
              className={"nv " + (pathname.startsWith(href) ? "on" : "")}
              href={href}
              key={href}
              title={label}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {href === "/chats" ? (
                  <path d="M4 5h16v11H9l-5 4z" />
                ) : (
                  <>
                    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
                    <circle cx="16" cy="7" r="2" />
                    <circle cx="8" cy="17" r="2" />
                  </>
                )}
              </svg>
              <span>{label}</span>
              {href === "/chats" && badge > 0 && <em>{badge}</em>}
            </Link>
          ))}
        </nav>
        <div className="df">
          <div className={"st " + (paused ? "off" : "")}>
            <i className="dot" />
            <span>{paused ? "البوت متوقف" : "البوت يعمل"}</span>
          </div>
          <p>{user?.name}</p>
          <button
            className="btn logout"
            onClick={() =>
              api("/auth/logout", { method: "POST" }).then(() =>
                window.location.assign("/login"),
              )
            }
            title="تسجيل الخروج"
          >
            خروج
          </button>
        </div>
      </aside>
      <button
        className="sc"
        aria-label="إغلاق القائمة"
        onClick={() => setCollapsed(true)}
      />
      <main>
        <Alerts onBadge={setBadge} />
        {children}
      </main>
    </div>
  );
}
export function Toast({ message }: { message: string }) {
  return (
    <div
      className={"ts " + (message ? "on" : "")}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}
export function Switch({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="sw"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    />
  );
}
