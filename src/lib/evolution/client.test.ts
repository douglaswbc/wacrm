import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_SEND_DELAY,
  downloadMedia,
  editLabel,
  labelChat,
  listLabels,
  sendButtons,
  sendLink,
  sendList,
  sendMedia,
  sendText,
  unlabelChat,
} from './client';

const CREDS = { apiUrl: 'http://localhost:4000', instanceToken: 'tok-1' };

function mockFetch(response: unknown, opts?: { status?: number; contentType?: string }) {
  const fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(response), {
        status: opts?.status ?? 200,
        headers: { 'Content-Type': opts?.contentType ?? 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Evolution Go client — v2 payloads', () => {
  it('sendText posts number/text/delay to /send/text', async () => {
    const f = mockFetch({ key: { id: 'm1' } });
    const r = await sendText({ ...CREDS, number: '5511999999999', message: 'oi' });
    expect(r.key?.id).toBe('m1');
    expect(f).toHaveBeenCalledWith(
      'http://localhost:4000/send/text',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          number: '5511999999999',
          text: 'oi',
          delay: DEFAULT_SEND_DELAY,
        }),
      }),
    );
    const init = f.mock.calls[0][1] as RequestInit;
    expect(new Headers(init.headers).get('apikey')).toBe('tok-1');
  });

  it('sendLink posts to /send/link', async () => {
    const f = mockFetch({ key: { id: 'm2' } });
    await sendLink({ ...CREDS, number: '5511999999999', message: 'https://x.com' });
    expect(f.mock.calls[0][0]).toBe('http://localhost:4000/send/link');
  });

  it('sendMedia posts the v2 url/filename/type payload', async () => {
    const f = mockFetch({ key: { id: 'm3' } });
    await sendMedia({
      ...CREDS,
      number: '5511999999999',
      mediaType: 'document',
      mediaUrl: 'https://cdn.example.com/file.pdf',
      caption: 'teste',
      fileName: 'arquivo.pdf',
    });
    expect(f.mock.calls[0][0]).toBe('http://localhost:4000/send/media');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({
      number: '5511999999999',
      url: 'https://cdn.example.com/file.pdf',
      type: 'document',
      caption: 'teste',
      filename: 'arquivo.pdf',
      delay: DEFAULT_SEND_DELAY,
    });
  });

  it('sendButtons posts title/description/footer with all button types', async () => {
    const f = mockFetch({ key: { id: 'm4' } });
    await sendButtons({
      ...CREDS,
      number: '5511999999999',
      headerText: 'Whatsmeow',
      contentText: 'botão pela whatsmeow',
      footerText: 'Clique nos botões',
      buttons: [
        { type: 'reply', displayText: 'Resposta 1', id: '1' },
        { type: 'copy', displayText: 'Copia Código', copyCode: 'ZXN0ZQ==' },
        { type: 'url', displayText: 'Evolution API', url: 'https://evolution-api.com' },
        { type: 'call', displayText: 'Me ligue', phoneNumber: '557499879409' },
        {
          type: 'pix',
          currency: 'BRL',
          name: 'Davidson Gomes',
          keyType: 'random',
          key: '0ea59ac5-f001-4f0e-9785-c772200f1b1e',
        },
      ],
    });
    expect(f.mock.calls[0][0]).toBe('http://localhost:4000/send/button');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.title).toBe('Whatsmeow');
    expect(body.description).toBe('botão pela whatsmeow');
    expect(body.footer).toBe('Clique nos botões');
    expect(body.delay).toBe(DEFAULT_SEND_DELAY);
    expect(body.buttons).toHaveLength(5);
    expect(body.buttons[0]).toEqual({ type: 'reply', displayText: 'Resposta 1', id: '1' });
    expect(body.buttons[1]).toEqual({
      type: 'copy',
      displayText: 'Copia Código',
      copyCode: 'ZXN0ZQ==',
    });
    expect(body.buttons[4].keyType).toBe('random');
  });

  it('sendList posts description/footerText and rowId rows', async () => {
    const f = mockFetch({ key: { id: 'm5' } });
    await sendList({
      ...CREDS,
      number: '5511999999999',
      headerText: 'List Title',
      contentText: 'List description',
      buttonText: 'Click Here',
      footerText: 'footer list',
      sections: [
        {
          title: 'Section 01',
          rows: [{ id: 'rowId 001', title: 'Title row 01', description: 'Lorem' }],
        },
      ],
    });
    expect(f.mock.calls[0][0]).toBe('http://localhost:4000/send/list');
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.description).toBe('List description');
    expect(body.footerText).toBe('footer list');
    expect(body.buttonText).toBe('Click Here');
    expect(body.sections[0].rows[0].rowId).toBe('rowId 001');
    expect(body.delay).toBe(DEFAULT_SEND_DELAY);
  });
});

describe('Evolution Go client — media download', () => {
  it('decodes a base64 JSON answer', async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    mockFetch({ base64: Buffer.from(bytes).toString('base64'), mimetype: 'image/jpeg' });
    const r = await downloadMedia({
      ...CREDS,
      message: { imageMessage: { mimetype: 'image/jpeg' } },
    });
    expect(new Uint8Array(r.buffer)).toEqual(bytes);
    expect(r.mimetype).toBe('image/jpeg');
  });

  it('returns raw binary when the API streams bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const r = await downloadMedia({ ...CREDS, message: {} });
    expect(new Uint8Array(r.buffer)).toEqual(Uint8Array.from([9, 8, 7]));
    expect(r.mimetype).toBe('application/octet-stream');
  });
});

describe('Evolution Go client — labels', () => {
  it('listLabels unwraps bare arrays and wrapped payloads', async () => {
    mockFetch([{ id: '1', name: 'A', color: 0 }]);
    expect(await listLabels(CREDS)).toHaveLength(1);

    mockFetch({ data: [{ id: '2', name: 'B', color: 3 }] });
    const wrapped = await listLabels(CREDS);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].name).toBe('B');

    mockFetch({});
    expect(await listLabels(CREDS)).toEqual([]);
  });

  it('labelChat/unlabelChat post jid + labelId to the right paths', async () => {
    const f = mockFetch({ ok: true });
    await labelChat({ ...CREDS, jid: '5511999999999@s.whatsapp.net', labelId: '8' });
    expect(f.mock.calls[0][0]).toBe('http://localhost:4000/label/chat');
    await unlabelChat({ ...CREDS, jid: '5511999999999@s.whatsapp.net', labelId: '8' });
    expect(f.mock.calls[1][0]).toBe('http://localhost:4000/unlabel/chat');
    const body = JSON.parse((f.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toEqual({ jid: '5511999999999@s.whatsapp.net', labelId: '8' });
  });

  it('editLabel sends name/color and optional labelId/deleted', async () => {
    const f = mockFetch({ ok: true });
    await editLabel({ ...CREDS, name: 'label', color: 1, deleted: true, labelId: '8' });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toEqual({ name: 'label', color: 1, labelId: '8', deleted: true });
  });
});
