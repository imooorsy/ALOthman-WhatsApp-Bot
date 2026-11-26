"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { normalizeText, toWesternDigits } = require("./ai/src/normalize");
const policy = fs.readFileSync(
  path.join(__dirname, "dashboard-intake.md"),
  "utf8",
);
const readable = (text) =>
  String(text).split(/\s+/).map(normalizeText).join(" ").toLowerCase();

function requestedStaff(messages) {
  const latest = readable(messages.join("\n"));
  if (
    /لا (?:تحولني|اريد.{0,12}موظف)|don't transfer|do not transfer/.test(latest)
  )
    return false;
  if (/^(?:حولني|موظف|human|employee)[.!؟]*$/.test(latest.trim())) return true;
  return /(?:اريد|ابي|ابغي|عايز|محتاج).{0,20}(?:اكلم موظف|التحدث.{0,12}موظف|التواصل.{0,12}موظف|موظف يتواصل)|حولني.{0,16}(?:موظف|بشر|محام)|talk to (?:a )?(?:human|employee|person)|human please/.test(
    latest,
  );
}

function routingProblems(output, memory, req) {
  if (
    output.action === "urgent" ||
    output.priority === "عاجل" ||
    output.status === "عاجل" ||
    requestedStaff(req.newMessages)
  )
    return [];
  if (!["refer", "existing_client", "book"].includes(output.action)) return [];
  if (output.action === "existing_client") {
    const said = readable(
      [
        ...req.history.filter((m) => m.role === "client").map((m) => m.text),
        ...req.newMessages,
      ].join("\n"),
    ).toLowerCase();
    const activeFile =
      /(?:ملف|قضي|تمثلون).{0,80}(?:عندكم|لديكم|معكم|مكتبكم|لدي المكتب)|(?:عندكم|لديكم|معكم|مكتبكم|لدي المكتب).{0,80}(?:ملف|قضي)|you already represent me|(?:case|file).{0,30}(?:with you|your office)/.test(
        said,
      );
    const deniedFile =
      /(?:ليس|لا يوجد|ما عندي|مش عندي|لا املك).{0,35}(?:ملف|قضي).{0,35}(?:عندكم|مكتبكم|معكم)/.test(
        readable(req.newMessages.join(" ")),
      );
    if (!activeFile || deniedFile)
      return [
        "لا يوجد تصريح من العميل بملف قائم لدى المكتب. رسائل الموظف السابقة لا تثبت ذلك. لا تستخدم existing_client أو تطلب رقم ملف؛ استمر في استقبال طلبه الحالي.",
      ];
    return [];
  }
  const questions = output.asking_about || [];
  const pending = Object.values(memory).filter(
    (f) => f.required && f.status === "ناقص" && (f.asked || 0) < 2,
  );
  if (
    questions.some((field) =>
      pending.some((f) => normalizeText(f.field) === normalizeText(field)),
    )
  )
    return [
      "ما زلت تسأل عن معلومة استقبال لازمة وغير محسومة: استخدم ask واستمر بدل التحويل الآن، أو بيّن سببًا حقيقيًا يستلزم الموظف دون هذا السؤال.",
    ];
  if (output.action === "book") {
    const nameKnown = !!(output.client_name?.trim() || req.state?.name);
    const phoneKnown =
      !!req.clientPhone ||
      Object.values(memory).some(
        (f) =>
          /هاتف|جوال|رقم.*تواصل|phone|mobile/i.test(f.field) &&
          f.status === "معروف" &&
          /^\+?[1-9]\d{7,14}$/.test(
            toWesternDigits(f.value).replace(/[\s()-]/g, ""),
          ),
      );
    if (
      !nameKnown ||
      !phoneKnown ||
      !output.service?.trim() ||
      output.requested === "غير محدد"
    )
      return [
        "طلب الموعد غير جاهز للتسليم: استكمل الاسم ووسيلة التواصل والموضوع والخدمة الناقصة فقط، ولا تستخدم book الآن. لا تكرر سؤالًا رفض العميل إجابته أو قال إنه لا يعرفه؛ أحل للموظف بسبب واضح عند تعذر البيانات.",
      ];
  }
  return [];
}
module.exports = { policy, requestedStaff, routingProblems };
