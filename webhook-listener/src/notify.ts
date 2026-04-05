import { log } from './logger.js';

export function buildMessage(event: string, ctx: { activity_id?: number; error?: string; [key: string]: unknown }): string {
  const lines = [`⚠️ htmitub webhook-listener: ${event}`];
  if (ctx.activity_id != null) lines.push(`Activity ID: ${ctx.activity_id}`);
  if (ctx.error) lines.push(`Error: ${ctx.error}`);
  lines.push(`Time: ${new Date().toISOString()}`);
  return lines.join('\n');
}

export async function notify(event: string, ctx: { activity_id?: number; error?: string; [key: string]: unknown } = {}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    log('warn', 'telegram_not_configured');
    return;
  }
  const text = buildMessage(event, ctx);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) log('warn', 'telegram_send_failed', { status: res.status });
  } catch (err) {
    log('error', 'telegram_send_error', { error: String(err) });
  }
}
