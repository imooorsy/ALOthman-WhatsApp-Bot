"use client";
import { useState } from "react";
import { api } from "../../components/api";
export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login">
      <form
        className="pn f"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            await api("/auth/login", {
              method: "POST",
              body: JSON.stringify({
                email: data.get("email"),
                password: data.get("password"),
              }),
            });
            window.location.assign("/chats");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="mono">ع</div>
        <h1>تسجيل الدخول إلى لوحة عثمان</h1>
        <label htmlFor="email">البريد الإلكتروني</label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          required
        />
        <label htmlFor="password">كلمة المرور</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <p role="alert">{error}</p>
        <button className="btn p" disabled={busy}>
          {busy ? "جارٍ الدخول…" : "تسجيل الدخول"}
        </button>
      </form>
    </main>
  );
}
