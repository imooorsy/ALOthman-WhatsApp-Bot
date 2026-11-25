import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
export interface IWhatsAppProvider {
  send(phone: string, text: string): Promise<{ id: string }>;
}
@Injectable()
export class WhatsAppProvider implements IWhatsAppProvider {
  async send(phone: string, text: string) {
    if ((process.env.WA_PROVIDER || "mock") === "mock")
      return { id: "mock-" + randomUUID() };
    if (process.env.WA_PROVIDER !== "meta")
      throw new Error("Unsupported WhatsApp provider");
    const response = await fetch(
      `https://graph.facebook.com/${process.env.WA_API_VERSION}/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone.replace(/\D/g, ""),
          type: "text",
          text: { body: text },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!response.ok) throw new Error("WhatsApp delivery failed");
    const data = (await response.json()) as { messages?: { id: string }[] };
    if (!data.messages?.[0]?.id) throw new Error("Invalid WhatsApp response");
    return { id: data.messages[0].id };
  }
}
