// Sending an approved reply: real email over SMTP for the live inbox, or the
// outbox (stored, never delivered) for demo tickets.
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string; inReplyTo: string | null };
export type Sent = { transport: "outbox" | "smtp"; messageId: string; to: string; at: string };

export async function outbox(m: Mail): Promise<Sent> {
  return { transport: "outbox", messageId: `<${randomUUID()}@outbox.replypilot>`, to: m.to, at: new Date().toISOString() };
}

export function smtp(url: string, from: string) {
  const transport = nodemailer.createTransport(url);
  return async (m: Mail): Promise<Sent> => {
    const thread = m.inReplyTo ?? undefined;
    const info = await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, inReplyTo: thread, references: thread });
    return { transport: "smtp", messageId: info.messageId, to: m.to, at: new Date().toISOString() };
  };
}
