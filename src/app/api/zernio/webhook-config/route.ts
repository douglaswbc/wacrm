import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  findWacrmWebhook,
} from '@/lib/zernio/client';

const ZERNIO_WEBHOOK_URL =
  process.env.NEXT_PUBLIC_SITE_URL
    ? `${process.env.NEXT_PUBLIC_SITE_URL}/api/zernio/webhook`
    : '/api/zernio/webhook';

const DEFAULT_EVENTS = [
  'message.received',
  'comment.received',
  'post.platform.published',
  'post.platform.failed',
];

export async function GET() {
  try {
    await requireRole('admin');

    const existing = await findWacrmWebhook(ZERNIO_WEBHOOK_URL);

    if (!existing) {
      return NextResponse.json({
        configured: false,
        webhookUrl: ZERNIO_WEBHOOK_URL,
        webhooks: await listWebhooks(),
      });
    }

    return NextResponse.json({
      configured: true,
      webhook: {
        id: existing.id,
        url: existing.url,
        name: existing.name,
        events: existing.events,
        isActive: existing.isActive,
        lastDeliveryAt: existing.lastDeliveryAt,
        lastDeliveryStatus: existing.lastDeliveryStatus,
        failureCount: existing.failureCount,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    await requireRole('admin');

    const body = await request.json().catch(() => ({}));
    const events = (body.events as string[]) ?? DEFAULT_EVENTS;
    const name = (body.name as string) ?? 'WACRM Webhook';

    const existing = await findWacrmWebhook(ZERNIO_WEBHOOK_URL);

    let result;
    if (existing) {
      result = await updateWebhook({
        id: existing.id,
        name,
        events,
      });
    } else {
      result = await createWebhook({
        name,
        url: ZERNIO_WEBHOOK_URL,
        events,
      });
    }

    return NextResponse.json({
      configured: true,
      webhook: {
        id: result.id,
        url: result.url,
        name: result.name,
        events: result.events,
        isActive: result.isActive,
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    await requireRole('admin');

    const existing = await findWacrmWebhook(ZERNIO_WEBHOOK_URL);
    if (!existing) {
      return NextResponse.json({ error: 'No WACRM webhook configured' }, { status: 404 });
    }

    await deleteWebhook(existing.id);

    return NextResponse.json({ deleted: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
