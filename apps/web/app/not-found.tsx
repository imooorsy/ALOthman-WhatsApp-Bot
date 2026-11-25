import Link from "next/link";
export default function NotFound() {
  return (
    <main className="login">
      <section className="pn f">
        <h1>الصفحة غير موجودة</h1>
        <p>تعذر العثور على الصفحة المطلوبة.</p>
        <Link className="btn" href="/chats">
          العودة إلى المحادثات
        </Link>
      </section>
    </main>
  );
}
