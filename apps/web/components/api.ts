export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + path, {
      credentials: "include",
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      cache: "no-store",
    });
  } catch {
    throw new Error("تعذر الاتصال بالخادم؛ تحقق من الاتصال وحاول مجددًا");
  }
  if (response.status === 401) {
    if (
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    )
      window.location.assign("/login");
    throw new Error("يرجى تسجيل الدخول");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("تعذر قراءة استجابة الخادم؛ حاول مجددًا");
  }
  if (!response.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "تعذر تنفيذ الطلب؛ تحقق من البيانات وحاول مجددًا",
    );
  if (path === "/settings/preferences" && typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("osman:prefs", { detail: data.notifyPrefs }),
    );
  return data as T;
}
