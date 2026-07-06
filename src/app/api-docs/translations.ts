export type Lang = 'pt' | 'es' | 'en';

export interface TranslationSet {
  pageTitle: string;
  pageSubtitle: string;
  languageLabel: string;

  authTitle: string;
  authDesc: string;
  authKeyDesc: string;
  authCreatingTitle: string;
  authCreatingStep1: string;
  authCreatingStep2: string;
  authCreatingStep3: string;
  authRevokingTitle: string;
  authRevokingDesc: string;

  scopesTitle: string;
  scopesDesc: string;
  scopesHeaderScope: string;
  scopesHeaderAllows: string;
  scopesNoScopes: string;

  envelopeTitle: string;
  envelopeDesc: string;
  envelopeStatus: string;
  envelopeCode: string;
  envelopeMeaning: string;

  rateLimitTitle: string;
  rateLimitDesc: string;
  rateLimitHeaders: string;
  rateLimitNote: string;

  endpointsTitle: string;
  paginationTitle: string;
  paginationDesc: string;
  paginationCursors: string;
  paginationNote: string;

  webhooksTitle: string;
  webhooksDesc: string;
  webhooksMigration: string;
  webhooksEventsTitle: string;
  webhooksEventsHeaderEvent: string;
  webhooksEventsHeaderFires: string;
  webhooksManageTitle: string;
  webhooksDeliveryTitle: string;
  webhooksDeliveryDesc: string;
  webhooksVerifyTitle: string;
  webhooksSemanticsTitle: string;
  webhooksSemanticsBestEffort: string;
  webhooksSemanticsTargetRestrictions: string;

  roadmapTitle: string;
  roadmapDesc: string;

  copyLabel: string;
  copiedLabel: string;
  required: string;
  optional: string;
  response: string;
}

const t: Record<Lang, TranslationSet> = {
  pt: {
    pageTitle: 'API Pública (/api/v1)',
    pageSubtitle: 'A API pública permite que você controle sua instância wacrm a partir dos seus próprios scripts e automações — enviar mensagens, gerenciar contatos, lançar broadcasts e muito mais — sem passar pela interface do dashboard.',
    languageLabel: 'Idioma',

    authTitle: 'Autenticação',
    authDesc: 'Toda requisição é autenticada com uma chave de API (API key), enviada como um token Bearer:',
    authKeyDesc: 'As chaves têm escopo por conta: uma chave atua em exatamente uma conta, na qual foi criada. Não há acesso entre contas.',
    authCreatingTitle: 'Criar uma chave',
    authCreatingStep1: 'Dê um nome à chave (de acordo com a integração que a usará).',
    authCreatingStep2: 'Conceda os escopos necessários — nada mais (veja abaixo).',
    authCreatingStep3: 'Copie a chave. A chave completa é mostrada exatamente uma vez. O wacrm armazena apenas um hash SHA-256, portanto ela nunca poderá ser mostrada novamente. Se você a perder, revogue-a e crie uma nova.',
    authRevokingTitle: 'Revogar uma chave',
    authRevokingDesc: 'Configurações → API keys → Revogar. A revogação é efetiva na próxima requisição da chave. Chaves revogadas permanecem na lista como trilha de auditoria.',

    scopesTitle: 'Escopos',
    scopesDesc: 'Uma chave só pode fazer o que seus escopos permitem — independentemente de quem a criou. Conceda o mínimo necessário.',
    scopesHeaderScope: 'Escopo',
    scopesHeaderAllows: 'Permite',
    scopesNoScopes: 'Uma chave sem escopos ainda autentica e pode chamar GET /api/v1/me — útil para verificar se a chave funciona.',

    envelopeTitle: 'Formato da Resposta',
    envelopeDesc: 'Toda resposta usa um dos dois formatos:',
    envelopeStatus: 'Status',
    envelopeCode: 'Código',
    envelopeMeaning: 'Significado',

    rateLimitTitle: 'Limite de Taxa',
    rateLimitDesc: 'As requisições são limitadas por chave: 120 requisições por minuto. Em um 429, estes cabeçalhos informam quando tentar novamente:',
    rateLimitHeaders: 'Retry-After — segundos até o reset da janela; X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    rateLimitNote: 'O limitador é em memória e por processo. Uma implantação de instância única (o caso comum para um fork auto-hospedado) funciona como está. Se você escalar para múltiplas instâncias, substitua o limitador por um armazenamento compartilhado (Redis/Upstash).',

    endpointsTitle: 'Endpoints',
    paginationTitle: 'Paginação',
    paginationDesc: 'Todo endpoint de lista pagina da mesma forma. Solicite um tamanho de página com ?limit= (padrão 50, máximo 100) e leia a próxima página com o cursor opaco meta.next_cursor da resposta anterior:',
    paginationCursors: 'Os cursores são baseados em keyset (estáveis sob inserções concorrentes). Passe o cursor de volta literalmente — não o analise. next_cursor: null significa última página.',
    paginationNote: '',

    webhooksTitle: 'Webhooks',
    webhooksDesc: 'Em vez de fazer polling, registre um endpoint e o wacrm fará POST para ele quando algo acontecer na sua conta.',
    webhooksMigration: 'Migração necessária: aplique supabase/migrations/028_webhook_endpoints.sql.',
    webhooksEventsTitle: 'Eventos',
    webhooksEventsHeaderEvent: 'Evento',
    webhooksEventsHeaderFires: 'Dispara quando',
    webhooksManageTitle: 'Gerenciar Endpoints',
    webhooksDeliveryTitle: 'Payload de Entrega',
    webhooksDeliveryDesc: 'Cada entrega é um POST com este envelope; id é um uuid único por entrega para deduplicação, e data varia por evento:',
    webhooksVerifyTitle: 'Verificar a Assinatura',
    webhooksSemanticsTitle: 'Semântica de Entrega',
    webhooksSemanticsBestEffort: 'A entrega é best-effort: uma única tentativa por evento com um timeout curto, e redirecionamentos não são seguidos. O message.status_updated cobre mensagens que o wacrm armazena (inbox + API), não apenas envios de broadcast. Devido a reenvios e reordenação dos provedores, o mesmo status pode chegar mais de uma vez ou fora de ordem — deduplique pelo id e não assuma ordenação. Cada falha consecutiva incrementa failure_count; após falhas suficientes, o endpoint é desativado automaticamente (is_active: false) — reative com PATCH.',
    webhooksSemanticsTargetRestrictions: 'Restrições de destino (SSRF). A url deve ser https:// e deve resolver para um endereço público — requisições para localhost, faixas privadas/RFC1918, link-local e alvos internos similares são recusados no momento da entrega.',

    roadmapTitle: 'Roteiro',
    roadmapDesc: 'A API pública agora cobre mensagens, contatos, conversas, broadcasts, pipelines, deals e webhooks de saída — o escopo completo. Ideias futuras (templates, flows, uma fila de entrega para webhooks) ainda não estão agendadas.',

    copyLabel: 'Copiar',
    copiedLabel: 'Copiado!',
    required: 'Obrigatório',
    optional: 'Opcional',
    response: 'Resposta',
  },

  es: {
    pageTitle: 'API Pública (/api/v1)',
    pageSubtitle: 'La API pública le permite controlar su instancia wacrm desde sus propios scripts y automatizaciones — enviar mensajes, gestionar contactos, lanzar broadcasts y más — sin pasar por la interfaz del dashboard.',
    languageLabel: 'Idioma',

    authTitle: 'Autenticación',
    authDesc: 'Cada solicitud se autentica con una clave de API, enviada como token Bearer:',
    authKeyDesc: 'Las claves tienen alcance por cuenta: una clave actúa exactamente en una cuenta, en la que fue creada. No hay acceso entre cuentas.',
    authCreatingTitle: 'Crear una clave',
    authCreatingStep1: 'Asigne un nombre a la clave (según la integración que la usará).',
    authCreatingStep2: 'Conceda los alcances necesarios — nada más (vea abajo).',
    authCreatingStep3: 'Copie la clave. La clave completa se muestra exactamente una vez. wacrm almacena solo un hash SHA-256, por lo que nunca podrá mostrarse nuevamente. Si la pierde, revóquela y cree una nueva.',
    authRevokingTitle: 'Revocar una clave',
    authRevokingDesc: 'Configuración → API keys → Revocar. La revocación es efectiva en la próxima solicitud de la clave. Las claves revocadas permanecen en la lista como registro de auditoría.',

    scopesTitle: 'Alcances',
    scopesDesc: 'Una clave solo puede hacer lo que sus alcances permiten — independientemente de quién la creó. Conceda lo mínimo necesario.',
    scopesHeaderScope: 'Alcance',
    scopesHeaderAllows: 'Permite',
    scopesNoScopes: 'Una clave sin alcances aún autentica y puede llamar a GET /api/v1/me — útil para verificar que la clave funciona.',

    envelopeTitle: 'Formato de Respuesta',
    envelopeDesc: 'Cada respuesta usa uno de dos formatos:',
    envelopeStatus: 'Estado',
    envelopeCode: 'Código',
    envelopeMeaning: 'Significado',

    rateLimitTitle: 'Límite de Tasa',
    rateLimitDesc: 'Las solicitudes están limitadas por clave: 120 solicitudes por minuto. En un 429, estos encabezados indican cuándo reintentar:',
    rateLimitHeaders: 'Retry-After — segundos hasta el reinicio de la ventana; X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    rateLimitNote: 'El limitador está en memoria y por proceso. Una implementación de instancia única funciona como está. Si escala a múltiples instancias, reemplace el limitador por un almacenamiento compartido (Redis/Upstash).',

    endpointsTitle: 'Endpoints',
    paginationTitle: 'Paginación',
    paginationDesc: 'Cada endpoint de lista pagina de la misma forma. Solicite un tamaño de página con ?limit= (por defecto 50, máximo 100) y lea la página siguiente con el cursor opaco meta.next_cursor de la respuesta anterior:',
    paginationCursors: 'Los cursores se basan en keyset (estables bajo inserciones concurrentes). Devuelva el cursor tal cual — no lo analice. next_cursor: null significa última página.',
    paginationNote: '',

    webhooksTitle: 'Webhooks',
    webhooksDesc: 'En lugar de hacer polling, registre un endpoint y wacrm hará POST cuando algo ocurra en su cuenta.',
    webhooksMigration: 'Migración requerida: aplique supabase/migrations/028_webhook_endpoints.sql.',
    webhooksEventsTitle: 'Eventos',
    webhooksEventsHeaderEvent: 'Evento',
    webhooksEventsHeaderFires: 'Se dispara cuando',
    webhooksManageTitle: 'Gestionar Endpoints',
    webhooksDeliveryTitle: 'Payload de Entrega',
    webhooksDeliveryDesc: 'Cada entrega es un POST con este envoltorio; id es un uuid único por entrega para deduplicación, y data varía por evento:',
    webhooksVerifyTitle: 'Verificar la Firma',
    webhooksSemanticsTitle: 'Semántica de Entrega',
    webhooksSemanticsBestEffort: 'La entrega es best-effort: un solo intento por evento con un timeout corto, y no se siguen redirecciones. message.status_updated cubre mensajes que wacrm almacena (inbox + API), no solo envíos de broadcast. Debido a reenvíos y reordenación, el mismo estado puede llegar más de una vez o fuera de orden — deduplique por id y no asuma orden. Cada fallo consecutivo incrementa failure_count; tras suficientes fallos, el endpoint se desactiva automáticamente (is_active: false) — reactive con PATCH.',
    webhooksSemanticsTargetRestrictions: 'Restricciones de destino (SSRF). La url debe ser https:// y debe resolver a una dirección pública — solicitudes a localhost, rangos privados/RFC1918, link-local y destinos internos similares son rechazados.',

    roadmapTitle: 'Hoja de Ruta',
    roadmapDesc: 'La API pública ahora cubre mensajes, contactos, conversaciones, broadcasts, pipelines, deals y webhooks de salida — el alcance completo. Ideas futuras (templates, flows, una cola de entrega para webhooks) aún no están programadas.',

    copyLabel: 'Copiar',
    copiedLabel: '¡Copiado!',
    required: 'Requerido',
    optional: 'Opcional',
    response: 'Respuesta',
  },

  en: {
    pageTitle: 'Public API (/api/v1)',
    pageSubtitle: 'The public API lets you drive your wacrm instance from your own scripts and automations — send messages, manage contacts, launch broadcasts, and more — without going through the dashboard UI.',
    languageLabel: 'Language',

    authTitle: 'Authentication',
    authDesc: 'Every request authenticates with an API key, sent as a bearer token:',
    authKeyDesc: 'Keys are account-scoped: a key acts on exactly one account, the one it was created in. There is no cross-account access.',
    authCreatingTitle: 'Creating a key',
    authCreatingStep1: 'Give the key a name (after the integration that will use it).',
    authCreatingStep2: 'Grant the scopes it needs — nothing more (see below).',
    authCreatingStep3: 'Copy the key. The full key is shown exactly once. wacrm stores only a SHA-256 hash, so it can never be shown again. If you lose it, revoke it and create a new one.',
    authRevokingTitle: 'Revoking a key',
    authRevokingDesc: 'Settings → API keys → Revoke. Revocation is effective on the key\'s next request. Revoked keys stay in the list as an audit trail.',

    scopesTitle: 'Scopes',
    scopesDesc: 'A key can do only what its scopes allow — independent of who created it. Grant the minimum.',
    scopesHeaderScope: 'Scope',
    scopesHeaderAllows: 'Allows',
    scopesNoScopes: 'A key with no scopes still authenticates and can call GET /api/v1/me — useful for verifying a key works.',

    envelopeTitle: 'Response Envelope',
    envelopeDesc: 'Every response uses one of two shapes:',
    envelopeStatus: 'Status',
    envelopeCode: 'Code',
    envelopeMeaning: 'Meaning',

    rateLimitTitle: 'Rate Limits',
    rateLimitDesc: 'Requests are limited per key: 120 requests per minute. On a 429, these headers tell you when to retry:',
    rateLimitHeaders: 'Retry-After — seconds until the window resets; X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
    rateLimitNote: 'The limiter is in-memory and per process. A single-instance deploy (the common case for a self-hosted fork) is fine as-is. If you scale to multiple instances, swap the limiter for a shared store (Redis/Upstash).',

    endpointsTitle: 'Endpoints',
    paginationTitle: 'Pagination',
    paginationDesc: 'Every list endpoint pages the same way. Request a page size with ?limit= (default 50, max 100) and read the next page with the opaque meta.next_cursor from the previous response:',
    paginationCursors: 'Cursors are keyset-based (stable under concurrent inserts). Pass the cursor back verbatim — don\'t parse it. next_cursor: null means the last page.',
    paginationNote: '',

    webhooksTitle: 'Webhooks',
    webhooksDesc: 'Rather than polling, register an endpoint and wacrm will POST to it when things happen in your account.',
    webhooksMigration: 'Migration required: apply supabase/migrations/028_webhook_endpoints.sql.',
    webhooksEventsTitle: 'Events',
    webhooksEventsHeaderEvent: 'Event',
    webhooksEventsHeaderFires: 'Fires when',
    webhooksManageTitle: 'Managing Endpoints',
    webhooksDeliveryTitle: 'Delivery Payload',
    webhooksDeliveryDesc: 'Every delivery is a POST with this envelope; id is a unique per-delivery uuid you can dedupe on, and data varies by event:',
    webhooksVerifyTitle: 'Verifying the Signature',
    webhooksSemanticsTitle: 'Delivery Semantics',
    webhooksSemanticsBestEffort: 'Delivery is best-effort: a single attempt per event with a short timeout, and redirects are not followed. message.status_updated covers messages wacrm stores (inbox + API sends), not broadcast-only sends. Because providers re-send and re-order status callbacks, the same status may arrive more than once or out of order; dedupe on id and don\'t assume ordering. Each consecutive failure increments failure_count; after enough consecutive failures the endpoint is auto-disabled (is_active: false) — re-enable it with PATCH.',
    webhooksSemanticsTargetRestrictions: 'Target restrictions (SSRF). The url must be https:// and must resolve to a public address — requests to localhost, private/RFC1918 ranges, link-local, and similar internal targets are refused at delivery time.',

    roadmapTitle: 'Roadmap',
    roadmapDesc: 'The public API now covers messaging, contacts, conversations, broadcasts, pipelines, deals, and outbound webhooks — the full scope. Future ideas (templates, flows, a delivery queue for webhooks) are not yet scheduled.',

    copyLabel: 'Copy',
    copiedLabel: 'Copied!',
    required: 'Required',
    optional: 'Optional',
    response: 'Response',
  },
};

export default t;
