"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="login">
      <section className="pn f" role="alert">
        <h1>تعذر عرض الصفحة</h1>
        <p>حاول مرة أخرى أو أعد تحميل الصفحة.</p>
        <button className="btn p" onClick={reset}>
          إعادة المحاولة
        </button>
      </section>
    </main>
  );
}
