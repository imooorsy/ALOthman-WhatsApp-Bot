import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { evolutionUrl } from "./evolution-client";
export interface IWhatsAppProvider {
  send(phone: string, text: string): Promise<{ id: string }>;
}
@Injectable()
export class WhatsAppProvider implements IWhatsAppProvider {
  async send(phone: string, text: string) {
    if ((process.env.WA_PROVIDER || "mock") === "mock")
      return { id: "mock-" + randomUUID() };
    if (process.env.WA_PROVIDER === "evolution") {
      if (
        !process.env.EVOLUTION_URL ||
        !process.env.EVOLUTION_INSTANCE ||
        !process.env.EVOLUTION_API_KEY
      )
        throw new Error("Evolution is not configured");
      const response = await fetch(
        `${evolutionUrl()}/message/sendText/${encodeURIComponent(process.env.EVOLUTION_INSTANCE)}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.EVOLUTION_API_KEY,
          },
          body: JSON.stringify({
            number: /^\d{5,24}@lid$/.test(phone)
              ? phone
              : phone.replace(/\D/g, ""),
            text,
            linkPreview: false,
          }),
        },
      );
      if (!response.ok) throw new Error("Evolution delivery failed");
      const result = (await response.json()) as { key?: { id?: string } };
      if (!result.key?.id) throw new Error("Invalid Evolution response");
      return { id: result.key.id };
    }
    if (process.env.WA_PROVIDER !== "meta")
      throw new Error("Unsupported WhatsApp provider");
    if (!/^\+?[1-9]\d{7,14}(?:@s\.whatsapp\.net)?$/.test(phone))
      throw new Error("Meta requires a phone number");
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
