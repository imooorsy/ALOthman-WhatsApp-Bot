'use strict';
// What each alert means, in the words the office reads: on the page, and in the text sent to
// the alert channel (ALERT_WEBHOOK_URL). An alert never carries client data: its kind, the
// conversation's id and the time only.
const ALERT_TEXTS = {
  disconnected: 'انقطع اتصال رقم واتساب بالخادم',
  reconnected: 'عاد اتصال الرقم — راجع هاتف المكتب للرسائل التي وصلت وقت الانقطاع',
  delivery_failed: 'رسالة لم تصل إلى العميل',
  send_unknown: 'نتيجة إرسال رسالة غير مؤكدة — أُوقف المساعد في المحادثة؛ راجع واتساب قبل أي إعادة إرسال',
  reminder: 'طلب لم يستلمه موظف بعد',
  escalation: 'طلب تأخر استلامه كثيرًا',
  request: 'طلب جديد بانتظار موظف',
  request_urgent: 'طلب عاجل بانتظار موظف — يحتاج متابعة سريعة',
  phone_auto_reply: 'ردّ تطبيق واتساب على الرقم تلقائيًا — أوقف الرد التلقائي في التطبيق',
  interrupted: 'محادثة انقطع الرد فيها بإعادة التشغيل — راجعها قبل إعادة المساعد',
  storage_failed: 'تعذر حفظ البيانات على القرص — المساعد لا يرد حتى يعود الحفظ',
  storage_recovered: 'عاد حفظ البيانات',
  state_restored: 'كان ملف البيانات تالفًا عند التشغيل، فحُمّلت النسخة المحفوظة قبله (حتى 10 دقائق) — راجع آخر المحادثات',
  conversation_damaged: 'ملف محادثة تالف عند التشغيل، نُقل جانبًا — استرجعه من النسخة الاحتياطية',
  retention: 'حُذفت محادثات منتهية أقدم من مدة الاحتفاظ المعتمدة',
  internal_error: 'خطأ داخلي في الخادم — راجع السجل',
  model_failed: 'تعذر الفهم الآلي لرسالة — أُحيلت المحادثة للموظف',
  model_down: 'خدمة النموذج تتعطل متكررًا — راجع المفتاح والاتصال وحالة المزود',
  transcription_failed: 'تعذر تفريغ رسالة صوتية — طُلب من العميل ملخص مكتوب؛ راجع خدمة التفريغ',
  assistant_stopped: 'توقف المساعد عن الرد لنقص أحد المتطلبات',
  assistant_resumed: 'عاد المساعد للرد',
  assistant_unavailable: 'رسالة عميل لم يرد عليها المساعد لأنه غير جاهز',
  assistant_off: 'رسالة عميل والمساعد متوقف — أُحيلت للموظفين',
  paused: 'رسالة في محادثة أُوقف فيها المساعد ولم يستلمها موظف',
  existing_client: 'رسالة من رقم مستثنى (عميل حالي) — لا يرد عليها المساعد',
  unresolved_sender: 'رسالة من مرسل لم يُعرف رقمه — رد عليه من هاتف المكتب',
  unmatched_phone_reply: 'رد من هاتف المكتب لم يُطابَق بمحادثة — إن كان المساعد يرد على هذا العميل فأوقفه في محادثته',
  processing_failed: 'توقف الرد الآلي في محادثة — راجعها',
  media_failed: 'تعذر تنزيل مرفق من عميل — راجعه من هاتف المكتب',
  flood: 'رسائل كثيرة متتابعة من رقم واحد — أُوقف المساعد في محادثته حتى يراجعها موظف',
  clock_skew: 'ساعة الخادم متأخرة عن واتساب — فعّل مزامنة الوقت (NTP)',
  webhook_rejected: 'رُفضت رسائل من Evolution (سر الربط أو اسم الـinstance لا يطابق) — راجع إعداد الـwebhook',
  backup_failed: 'فشل النسخ الاحتياطي — راجع سجل elmaster-backup',
  test: 'تنبيه تجريبي من مساعد الاستقبال — قناة التنبيهات تعمل',
};
const alertText = (kind) => ALERT_TEXTS[kind] || kind;

// Sends one alert to the channel. Slack- and Teams-like endpoints take a "text"; the other
// fields are for an endpoint that reads them. A refusal (non-2xx) or a network failure is
// returned, never thrown: { ok, status } or { ok: false, error }.
async function postAlert(url, { kind, conversation = null, at = Date.now(), origin = '' }, fetcher = fetch) {
  const text = `مساعد الاستقبال: ${alertText(kind)}${conversation ? ' (محادثة في اللوحة)' : ''}${origin ? ` — ${origin}` : ''}`;
  try {
    const response = await fetcher(url, { method: 'POST', signal: AbortSignal.timeout(5000), redirect: 'error',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, kind, conversation, at }) });
    response.body?.cancel?.().catch?.(() => {});
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, error: `http_${response.status}` };
  } catch (error) {
    const code = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : String(error?.cause?.code || error?.code || error?.message || 'error');
    return { ok: false, error: code.replace(/[^\w.:-]/g, '_').slice(0, 60) };
  }
}

module.exports = { ALERT_TEXTS, alertText, postAlert };
