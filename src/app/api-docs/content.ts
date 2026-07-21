export interface EndpointDoc {
  method: string;
  path: string;
  scopes: string[];
  description: Record<string, string>;
  curl?: string;
  json?: string;
  notes?: string[];
  details?: string[];
}

export interface Section {
  type: 'section';
  title: Record<string, string>;
  content: string[];
}

export interface TableSection {
  type: 'table';
  title: Record<string, string>;
  headers: string[];
  rows: string[][];
}

export interface TextSection {
  type: 'text';
  title?: Record<string, string>;
  content: string[];
}

export type ContentBlock = Section | TableSection | TextSection;

const me: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/me',
  scopes: [],
  description: {
    pt: 'Retorna a conta à qual a chave está vinculada e os escopos que ela possui. Requer apenas uma chave válida (nenhum escopo). Use para verificar se a chave funciona e descobrir seus escopos.',
    es: 'Devuelve la cuenta a la que está vinculada la clave y los alcances que posee. Solo requiere una clave válida (ningún alcance). Úselo para verificar que la clave funciona y descubrir sus alcances.',
    en: 'Returns the account a key is bound to and the scopes it carries. Requires only a valid key (no scope). Use it to verify a key works and to discover its scopes.',
  },
  curl: `curl https://your-crm.example.com/api/v1/me \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": {
    "account": { "id": "...", "name": "Acme Inc" },
    "key": { "id": "...", "scopes": ["messages:send"] }
  }
}`,
};

const messages: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/messages',
  scopes: ['messages:send'],
  description: {
    pt: 'Envia uma mensagem para um contato. WhatsApp (Meta Cloud API ou RyzeAPI) usa número E.164; Instagram usa instagram_id. O endpoint encontra-ou-cria o contato + conversa e roteia automaticamente pelo canal configurado.',
    es: 'Envía un mensaje a un contacto. WhatsApp (Meta Cloud API o RyzeAPI) usa número E.164; Instagram usa instagram_id. El endpoint encuentra-o-crea el contacto + conversación y enruta automáticamente por el canal configurado.',
    en: 'Send a message to a contact. WhatsApp (Meta Cloud API or RyzeAPI) uses an E.164 phone number; Instagram uses instagram_id. The endpoint finds-or-creates the contact + conversation and auto-routes through the configured channel.',
  },
  details: [
    'type is text (default), template, a media kind (image / video / document / audio), interactive (buttons / list), or pix.',
    'Text: needs text (body). Template: needs a template object with name, language, and params. Media: needs media_url (and optional filename); text doubles as the caption.',
    'Buttons (interactive): needs text (body text), buttons (1–3 items, each with id and title). Optional: header_text, footer_text. Supported on Meta, RyzeAPI, and Instagram.',
    'List (interactive): needs text (body), button_label, sections (1–10 sections, 1–10 rows total). Each row has id and title. Optional: header_text, footer_text. Supported on Meta, RyzeAPI, and Instagram.',
    'PIX: needs pix_key, pix_key_type (CPF|CNPJ|EMAIL|PHONE|RANDOM), merchant_name. Optional: text (message), pix_items (array of { name, quantity, unit_price }). Available only via RyzeAPI (native WhatsApp protocol).',
    'For RyzeAPI conversations, templates are sent as plain text with [template:name] prefix since RyzeAPI does not support Meta template format.',
    'Instagram conversations use instagram_id instead of phone. Private replies to comments are auto-detected from the conversation.',
    'Instagram interactive buttons are sent as web_url link buttons. List sections are rendered as plain text.',
  ],
  curl: `# Text message
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'

# Interactive buttons
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "buttons",
    "text": "Would you like to proceed?",
    "header_text": "Confirm Order",
    "footer_text": "Reply with your choice",
    "buttons": [
      { "id": "yes", "title": "Yes" },
      { "id": "no", "title": "No" }
    ]
  }'

# PIX payment (RyzeAPI only)
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "pix",
    "text": "Payment for Order #123",
    "pix_key": "123.456.789-00",
    "pix_key_type": "CPF",
    "merchant_name": "Acme Store",
    "pix_items": [
      { "name": "Widget", "quantity": 2, "unit_price": 49.90 }
    ]
  }'

# Image (RyzeAPI)
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "image",
    "text": "Check out our new product!",
    "media_url": "https://example.com/images/product.jpg"
  }'

# Video (RyzeAPI)
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "video",
    "text": "Watch our latest tutorial",
    "media_url": "https://example.com/videos/tutorial.mp4"
  }'

# Document (RyzeAPI)
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "document",
    "text": "Your invoice is ready",
    "media_url": "https://example.com/docs/invoice.pdf",
    "filename": "invoice-123.pdf"
  }'

# Audio (RyzeAPI)
curl -X POST https://your-crm.example.com/api/v1/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+14155550123",
    "type": "audio",
    "media_url": "https://example.com/audio/voice-note.ogg"
  }'`,
  json: `{
  "data": {
    "message_id": "...",
    "whatsapp_message_id": "wamid....",
    "conversation_id": "...",
    "contact_id": "...",
    "contact_created": true
  }
}`,
  notes: [
    'Domain error codes: whatsapp_not_configured (400), meta_error (502), template_malformed (500), ryzeapi_not_configured (400), ryzeapi_error (502), instagram_not_configured (400), instagram_error (502)',
    'PIX messages are only available via the RyzeAPI provider (native WhatsApp protocol). Meta Cloud API does not support PIX cards.',
  ],
};

const contactsList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/contacts',
  scopes: ['contacts:read'],
  description: {
    pt: 'Lista contatos, do mais recente primeiro. Paginado. Filtros opcionais: ?search= (nome ou telefone) e ?tag=<tagId>.',
    es: 'Lista contactos, del más reciente primero. Paginado. Filtros opcionales: ?search= (nombre o teléfono) y ?tag=<tagId>.',
    en: 'List contacts, newest first. Paginated. Optional filters: ?search= (matches name or phone) and ?tag=<tagId>.',
  },
  curl: `curl https://your-crm.example.com/api/v1/contacts?limit=50 \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "...", "name": "vip", "color": "#3b82f6" }],
      "created_at": "...", "updated_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
};

const contactsCreate: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/contacts',
  scopes: ['contacts:write'],
  description: {
    pt: 'Cria um contato. phone (E.164) é obrigatório; name, email, company e tags (array de nomes de tags) são opcionais. Find-or-create por telefone: uma correspondência existente retorna 200; um novo contato retorna 201.',
    es: 'Crea un contacto. phone (E.164) es obligatorio; name, email, company y tags (array de nombres de etiquetas) son opcionales. Find-or-create por teléfono: una coincidencia existente devuelve 200; un nuevo contacto devuelve 201.',
    en: 'Create a contact. phone (E.164) is required; name, email, company, and tags (an array of tag names) are optional. Find-or-create by phone: an existing match returns 200; a new contact returns 201.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/contacts \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "phone": "+14155550123",
        "name": "Jane Doe",
        "email": "jane@acme.com",
        "company": "Acme Inc",
        "tags": ["vip", "lead"]
      }'`,
  json: `{
  "data": {
    "id": "...",
    "phone": "+14155550123",
    "name": "Jane Doe",
    "email": "jane@acme.com",
    "company": "Acme Inc",
    "avatar_url": null,
    "tags": [
      { "id": "...", "name": "vip", "color": "#f59e0b" },
      { "id": "...", "name": "lead", "color": "#3b82f6" }
    ],
    "created_at": "...",
    "updated_at": "..."
  }
}`,
};

const contactsDetail: EndpointDoc = {
  method: 'GET / PATCH',
  path: '/api/v1/contacts/{id}',
  scopes: ['contacts:read', 'contacts:write'],
  description: {
    pt: 'Ler ou atualizar um contato. PATCH atualiza apenas os campos enviados (name, email, company). Passe tags (array) para substituir as tags do contato. Um contato de outra conta retorna 404.',
    es: 'Leer o actualizar un contacto. PATCH actualiza solo los campos enviados (name, email, company). Pase tags (array) para reemplazar las etiquetas del contacto. Un contacto de otra cuenta devuelve 404.',
    en: 'Read or update one contact. PATCH updates only the fields you send (name, email, company). Pass tags (an array) to replace the contact\'s tags. A contact in another account returns 404.',
  },
  curl: `# Read
curl https://your-crm.example.com/api/v1/contacts/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"

# Update
curl -X PATCH https://your-crm.example.com/api/v1/contacts/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Jane Updated", "company": "Acme Corp", "tags": ["vip"] }'`,
};

const conversationsList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/conversations',
  scopes: ['conversations:read'],
  description: {
    pt: 'Lista conversas, da mais recente primeiro. Paginado. Filtros opcionais: ?status= (open / pending / closed) e ?contact_id=. Cada conversa inclui seu contato + tags, além de channel e provider para identificar o canal de origem.',
    es: 'Lista conversaciones, de la más reciente primero. Paginado. Filtros opcionales: ?status= (open / pending / closed) y ?contact_id=. Cada conversación incluye su contacto + etiquetas, además de channel y provider para identificar el canal de origen.',
    en: 'List conversations, newest first. Paginated. Optional filters: ?status= (open / pending / closed) and ?contact_id=. Each conversation embeds its contact + tags, plus channel and provider to identify the source channel.',
  },
  curl: `curl https://your-crm.example.com/api/v1/conversations?status=open&limit=50 \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...",
      "status": "open",
      "channel": "whatsapp",
      "provider": "meta",
      "contact": { "id": "...", "phone": "+14155550123", "name": "Jane Doe" },
      "tags": [{ "id": "...", "name": "vip", "color": "#f59e0b" }],
      "last_message_at": "...",
      "created_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
};

const conversationsDetail: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/conversations/{id}',
  scopes: ['conversations:read'],
  description: {
    pt: 'Ler uma conversa. 404 se pertencer a outra conta.',
    es: 'Leer una conversación. 404 si pertenece a otra cuenta.',
    en: 'Read one conversation. 404 if it belongs to another account.',
  },
  curl: `curl https://your-crm.example.com/api/v1/conversations/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const conversationsMessages: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/conversations/{id}/messages',
  scopes: ['messages:read'],
  description: {
    pt: 'Lista as mensagens de uma conversa, da mais recente primeiro. Paginado. Cada mensagem inclui direction (inbound / outbound), status, whatsapp_message_id e content_*. A conversa é verificada como pertencente à sua conta primeiro (404 caso contrário).',
    es: 'Lista los mensajes de una conversación, del más reciente primero. Paginado. Cada mensaje incluye direction (inbound / outbound), status, whatsapp_message_id y content_*. La conversación se verifica como perteneciente a su cuenta primero (404 en caso contrario).',
    en: 'List a conversation\'s messages, newest first. Paginated. Each message includes its direction (inbound / outbound), status (delivery state), whatsapp_message_id, and content_*. The conversation is verified to belong to your account first (404 otherwise).',
  },
  curl: `curl https://your-crm.example.com/api/v1/conversations/{id}/messages?limit=50 \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...",
      "direction": "inbound",
      "status": "delivered",
      "whatsapp_message_id": "wamid....",
      "content_type": "text",
      "text": "Hi, I have a question about my order",
      "created_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
};

const broadcastsCreate: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/broadcasts',
  scopes: ['broadcasts:send'],
  description: {
    pt: 'Lança um broadcast de template para uma lista de destinatários. O broadcast + seus recipients são persistidos imediatamente e os envios são feitos em segundo plano, então a chamada retorna rápido — consulte GET /api/v1/broadcasts/{id} para progresso.',
    es: 'Lanza un broadcast de plantilla a una lista de destinatarios. El broadcast + sus destinatarios se persisten inmediatamente y los envíos se realizan en segundo plano, por lo que la llamada regresa rápido — consulte GET /api/v1/broadcasts/{id} para progreso.',
    en: 'Launch a template broadcast to a list of recipients. The broadcast + its recipient rows are persisted immediately and the sends fan out in the background, so the call returns fast — poll GET /api/v1/broadcasts/{id} for progress.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/broadcasts \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'`,
  json: `{
  "data": {
    "broadcast_id": "...",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}`,
  notes: ['Recipients are capped at 1000 per request — split larger sends. Invalid phone numbers are dropped and counted as rejected. Response (202).'],
};

const broadcastsDetail: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/broadcasts/{id}',
  scopes: ['broadcasts:send'],
  description: {
    pt: 'Status do broadcast + contagens. status move de sending → sent; delivered_count / read_count sobem conforme os webhooks de entrega da Meta chegam. 404 para broadcast de outra conta.',
    es: 'Estado del broadcast + contadores. status pasa de sending → sent; delivered_count / read_count suben a medida que llegan los webhooks de entrega de Meta. 404 para broadcast de otra cuenta.',
    en: 'Broadcast status + counts. status moves sending → sent; delivered_count / read_count keep climbing as Meta delivery webhooks arrive. 404 for another account\'s broadcast.',
  },
  curl: `curl https://your-crm.example.com/api/v1/broadcasts/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": {
    "id": "...",
    "name": "July promo",
    "status": "sent",
    "total_recipients": 2,
    "sent_count": 2,
    "delivered_count": 2,
    "read_count": 1,
    "replied_count": 0,
    "failed_count": 0,
    "created_at": "..."
  }
}`,
};

const pipelinesList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/pipelines',
  scopes: ['pipelines:read'],
  description: {
    pt: 'Lista todos os pipelines com seus estágios, ordenados por criação.',
    es: 'Lista todos los pipelines con sus etapas, ordenados por creación.',
    en: 'List all pipelines with their stages, ordered by creation.',
  },
  curl: `curl https://your-crm.example.com/api/v1/pipelines \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...",
      "name": "Sales Pipeline",
      "stages": [
        { "id": "...", "name": "Lead", "position": 0, "color": "#3b82f6", "created_at": "..." },
        { "id": "...", "name": "Qualified", "position": 1, "color": "#8b5cf6", "created_at": "..." }
      ],
      "created_at": "..."
    }
  ],
  "meta": { "next_cursor": null }
}`,
};

const pipelinesCreate: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/pipelines',
  scopes: ['pipelines:write'],
  description: {
    pt: 'Cria um novo pipeline. Opcionalmente inclua stages — um array de { name, position?, color? }.',
    es: 'Crea un nuevo pipeline. Opcionalmente incluya stages — un array de { name, position?, color? }.',
    en: 'Create a new pipeline. Optionally include stages — an array of { name, position?, color? }.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/pipelines \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "name": "Sales Pipeline",
        "stages": [
          { "name": "Lead", "color": "#3b82f6" },
          { "name": "Qualified", "color": "#8b5cf6" }
        ]
      }'`,
  json: `{
  "data": {
    "id": "...", "name": "Sales Pipeline",
    "stages": [ { "id": "...", "name": "Lead" }, { "id": "...", "name": "Qualified" } ],
    "created_at": "..."
  }
}`,
};

const pipelinesDetail: EndpointDoc = {
  method: 'GET / PATCH / DELETE',
  path: '/api/v1/pipelines/{id}',
  scopes: ['pipelines:read', 'pipelines:write'],
  description: {
    pt: 'Ler, atualizar ou deletar um pipeline. PATCH aceita { "name": "..." }. DELETE propaga para estágios e deals (todos os deals no pipeline são removidos). Retorna 404 para pipelines de outra conta.',
    es: 'Leer, actualizar o eliminar un pipeline. PATCH acepta { "name": "..." }. DELETE propaga a etapas y deals (todos los deals en el pipeline se eliminan). Devuelve 404 para pipelines de otra cuenta.',
    en: 'Read, update, or delete a pipeline. PATCH accepts { "name": "..." }. DELETE cascades to stages and deals (all deals in the pipeline are removed). Returns 404 for pipelines in another account.',
  },
  curl: `# Read
curl https://your-crm.example.com/api/v1/pipelines/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"

# Rename
curl -X PATCH https://your-crm.example.com/api/v1/pipelines/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "New Pipeline Name" }'

# Delete (cascades to stages & deals)
curl -X DELETE https://your-crm.example.com/api/v1/pipelines/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const pipelinesStages: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/pipelines/{id}/stages',
  scopes: ['pipelines:write'],
  description: {
    pt: 'Adiciona um estágio a um pipeline.',
    es: 'Añade una etapa a un pipeline.',
    en: 'Add a stage to a pipeline.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/pipelines/{id}/stages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Proposal", "color": "#10b981" }'`,
  json: `{
  "data": {
    "id": "...", "name": "Proposal", "position": 2, "color": "#10b981", "created_at": "..."
  }
}`,
};

const stagesDetail: EndpointDoc = {
  method: 'PATCH / DELETE',
  path: '/api/v1/stages/{id}',
  scopes: ['pipelines:write'],
  description: {
    pt: 'Atualizar ou deletar um estágio. PATCH aceita name, position, color. DELETE é recusado se o estágio ainda contiver deals — mova ou delete os deals primeiro. Retorna 404 para estágios de outra conta.',
    es: 'Actualizar o eliminar una etapa. PATCH acepta name, position, color. DELETE es rechazado si la etapa aún contiene deals — mueva o elimine los deals primero. Devuelve 404 para etapas de otra cuenta.',
    en: 'Update or delete a stage. PATCH accepts name, position, color. DELETE is refused if the stage still contains deals — move or delete them first. Returns 404 for stages in another account.',
  },
  curl: `# Rename / reorder
curl -X PATCH https://your-crm.example.com/api/v1/stages/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Proposal", "position": 2, "color": "#10b981" }'

# Delete (fails if deals exist in this stage)
curl -X DELETE https://your-crm.example.com/api/v1/stages/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const dealsList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/deals',
  scopes: ['deals:read'],
  description: {
    pt: 'Lista deals, do mais recente primeiro. Paginado. Filtros opcionais: ?pipeline_id=, ?stage_id=, ?status= (open / won / lost), ?contact_id=, ?assigned_to= (ID de perfil de um membro).',
    es: 'Lista deals, del más reciente primero. Paginado. Filtros opcionales: ?pipeline_id=, ?stage_id=, ?status= (open / won / lost), ?contact_id=, ?assigned_to= (ID de perfil de un miembro).',
    en: 'List deals, newest first. Paginated. Optional filters: ?pipeline_id=, ?stage_id=, ?status= (open / won / lost), ?contact_id=, ?assigned_to= (team member profile ID).',
  },
  curl: `curl https://your-crm.example.com/api/v1/deals?pipeline_id={id}&status=open&limit=50 \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...", "pipeline_id": "...", "stage_id": "...",
      "title": "ACME Project", "value": 15000.00, "currency": "BRL",
      "status": "open",
      "contact": { "id": "...", "phone": "+14155550123", "name": "Jane Doe", "avatar_url": null },
      "stage": { "id": "...", "name": "Qualified", "color": "#8b5cf6" },
      "assignee": { "id": "...", "full_name": "John", "email": "john@...", "avatar_url": null },
      "notes": null, "expected_close_date": "2026-09-30",
      "created_at": "...", "updated_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
};

const dealsCreate: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/deals',
  scopes: ['deals:write'],
  description: {
    pt: 'Cria um deal. pipeline_id, stage_id, contact_id e title são obrigatórios. Opcionalmente passe assigned_to (UUID de um perfil do membro do time) para atribuir o deal a um agente.',
    es: 'Crea un deal. pipeline_id, stage_id, contact_id y title son obligatorios. Opcionalmente pase assigned_to (UUID de un perfil de miembro del equipo) para asignar el deal a un agente.',
    en: 'Create a deal. pipeline_id, stage_id, contact_id, and title are required. Optionally pass assigned_to (UUID of a team member profile) to assign the deal to an agent.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/deals \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "pipeline_id": "...",
        "stage_id": "...",
        "contact_id": "...",
        "title": "ACME Project",
        "value": 15000.00,
        "currency": "BRL",
        "notes": "Interested in the enterprise plan",
        "expected_close_date": "2026-09-30",
        "assigned_to": "...",
        "conversation_id": "..."
      }'`,
  notes: ['Response (201): the serialized deal (same shape as list rows above).'],
};

const dealsDetail: EndpointDoc = {
  method: 'GET / PATCH / DELETE',
  path: '/api/v1/deals/{id}',
  scopes: ['deals:read', 'deals:write'],
  description: {
    pt: 'Ler, atualizar ou deletar um deal. PATCH aceita atualizações parciais em qualquer campo (title, value, currency, notes, expected_close_date, assigned_to, conversation_id, pipeline_id, stage_id, contact_id). Passe assigned_to: null para desatribuir. DELETE remove o deal permanentemente.',
    es: 'Leer, actualizar o eliminar un deal. PATCH acepta actualizaciones parciales en cualquier campo (title, value, currency, notes, expected_close_date, assigned_to, conversation_id, pipeline_id, stage_id, contact_id). Pase assigned_to: null para desasignar. DELETE elimina el deal permanentemente.',
    en: 'Read, update, or delete a single deal. PATCH accepts partial updates on any deal field (title, value, currency, notes, expected_close_date, assigned_to, conversation_id, pipeline_id, stage_id, contact_id). Pass assigned_to: null to unassign. DELETE removes the deal permanently.',
  },
  curl: `# Read a deal
curl https://your-crm.example.com/api/v1/deals/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"

# Update deal fields
curl -X PATCH https://your-crm.example.com/api/v1/deals/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "title": "Updated Project Name",
        "value": 25000.00,
        "stage_id": "new-stage-uuid"
      }'

# Delete a deal
curl -X DELETE https://your-crm.example.com/api/v1/deals/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const dealsMove: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/deals/{id}/move',
  scopes: ['deals:write'],
  description: {
    pt: 'Move um deal para um estágio diferente no mesmo pipeline.',
    es: 'Mueve un deal a una etapa diferente en el mismo pipeline.',
    en: 'Move a deal to a different stage in the same pipeline.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/deals/{id}/move \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "stage_id": "..." }'`,
  json: `{
  "data": {
    "moved": true,
    "deal": { "id": "...", "title": "...", "stage_id": "...", ... }
  }
}`,
};

const dealsStatus: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/deals/{id}/status',
  scopes: ['deals:write'],
  description: {
    pt: 'Atualiza o status de um deal. status deve ser open, won ou lost.',
    es: 'Actualiza el estado de un deal. status debe ser open, won o lost.',
    en: 'Update a deal\'s status. status must be open, won, or lost.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/deals/{id}/status \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "won" }'`,
  json: `{
  "data": { "id": "...", "title": "...", "status": "won", ... }
}`,
};

const webhooksList: EndpointDoc = {
  method: 'POST / GET',
  path: '/api/v1/webhooks',
  scopes: ['webhooks:manage'],
  description: {
    pt: 'Registrar ou listar endpoints de webhook. POST registra { "url": "https://...", "events": ["message.received"] }. A url deve ser https://. A resposta inclui secret exatamente uma vez. GET lista seus endpoints (nunca retorna o secret).',
    es: 'Registrar o listar endpoints de webhook. POST registra { "url": "https://...", "events": ["message.received"] }. La url debe ser https://. La respuesta incluye secret exactamente una vez. GET lista sus endpoints (nunca devuelve el secret).',
    en: 'Register or list webhook endpoints. POST registers { "url": "https://...", "events": ["message.received"] }. url must be https://. The response includes secret exactly once. GET lists your endpoints (never returns the secret).',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/webhooks \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'`,
};

const webhooksDetail: EndpointDoc = {
  method: 'GET / PATCH / DELETE',
  path: '/api/v1/webhooks/{id}',
  scopes: ['webhooks:manage'],
  description: {
    pt: 'Ler, atualizar ou remover um webhook. PATCH atualiza url, events ou is_active (reativar limpa o contador de falhas). DELETE remove permanentemente.',
    es: 'Leer, actualizar o eliminar un webhook. PATCH actualiza url, events o is_active (reactivar limpia el contador de fallos). DELETE elimina permanentemente.',
    en: 'Read, update, or delete a webhook. PATCH updates url, events, or is_active (re-enabling clears the failure counter). DELETE removes permanently.',
  },
  curl: `# Read
curl https://your-crm.example.com/api/v1/webhooks/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"

# Update
curl -X PATCH https://your-crm.example.com/api/v1/webhooks/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "url": "https://example.com/new-hooks/wacrm", "events": ["message.received", "conversation.created"] }'

# Delete
curl -X DELETE https://your-crm.example.com/api/v1/webhooks/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const instagramMessages: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/instagram/messages',
  scopes: ['messages:send'],
  description: {
    pt: 'Registra e envia mensagens bidirecionais do Instagram. Chamado pelo n8n: quando uma DM do Instagram chega (sender_type: customer) apenas persiste; quando é uma resposta (sender_type: agent | bot) envia via Instagram Graph API e persiste. Cria contato + conversa automaticamente se necessário.',
    es: 'Registra y envía mensajes bidireccionales de Instagram. Llamado por n8n: cuando un DM de Instagram llega (sender_type: customer) solo persiste; cuando es una respuesta (sender_type: agent | bot) envía a través de Instagram Graph API y persiste. Crea contacto + conversación automáticamente si es necesario.',
    en: 'Log and send bidirectional Instagram messages. Called by n8n: when an Instagram DM arrives (sender_type: customer) it only persists; when it is a reply (sender_type: agent | bot) it sends via the Instagram Graph API and persists. Creates contact + conversation automatically if needed.',
  },
  details: [
    'sender_type determines message direction: customer (default, inbound — only persists), agent (outbound by a human — sends + persists), bot (outbound automated — sends + persists).',
    'content_type must be one of: text, image, video, audio, document.',
    'instagram_id is required — the Instagram user/scoped-id from the sender.',
    'instagram_username and name are optional but help identify the contact.',
    'instagram_message_id is optional; pass it for dedup if Meta provides one.',
    'When sender_type is agent or bot, text or media_url is required for the outbound send.',
    'timestamp is optional ISO-8601; defaults to now.',
  ],
  curl: `# Inbound (customer DM)
curl -X POST https://your-crm.example.com/api/v1/instagram/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "instagram_id": "805905602035495",
        "instagram_username": "teste_teste",
        "sender_type": "customer",
        "content_type": "text",
        "text": "Ola, gostaria de saber mais sobre os produtos"
      }'

# Outbound (agent reply)
curl -X POST https://your-crm.example.com/api/v1/instagram/messages \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
        "instagram_id": "805905602035495",
        "sender_type": "agent",
        "content_type": "text",
        "text": "Ola! Claro, vou te ajudar com os produtos."
      }'`,
  json: `{
  "data": {
    "message_id": "...",
    "conversation_id": "...",
    "contact_id": "...",
    "contact_created": true,
    "conversation_created": true
  }
}`,
};

const membersList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/members',
  scopes: ['members:read'],
  description: {
    pt: 'Lista todos os membros do time da sua conta (perfis), ordenados por data de criação. Paginado. Filtro opcional: ?role= (owner / admin / agent / viewer). Use para descobrir os IDs de perfil necessários para o campo assigned_to em deals e conversas.',
    es: 'Lista todos los miembros del equipo de su cuenta (perfiles), ordenados por fecha de creación. Paginado. Filtro opcional: ?role= (owner / admin / agent / viewer). Úselo para descubrir los IDs de perfil necesarios para el campo assigned_to en deals y conversaciones.',
    en: 'List all team members in your account (profiles), ordered by creation date. Paginated. Optional filter: ?role= (owner / admin / agent / viewer). Use this to discover the profile IDs needed for the assigned_to field on deals and conversations.',
  },
  curl: `curl https://your-crm.example.com/api/v1/members?limit=50 \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...",
      "user_id": "...",
      "full_name": "Jane Doe",
      "email": "jane@acme.com",
      "avatar_url": null,
      "account_role": "admin",
      "created_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
};

const membersDetail: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/members/{id}',
  scopes: ['members:read'],
  description: {
    pt: 'Ler um membro específico pelo ID do perfil. 404 se pertencer a outra conta.',
    es: 'Leer un miembro específico por su ID de perfil. 404 si pertenece a otra cuenta.',
    en: 'Read a specific member by profile ID. 404 if it belongs to another account.',
  },
  curl: `curl https://your-crm.example.com/api/v1/members/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const conversationsAssign: EndpointDoc = {
  method: 'PATCH',
  path: '/api/v1/conversations/{id}',
  scopes: ['conversations:write'],
  description: {
    pt: 'Atualiza uma conversa. Atualmente suporta assigned_agent_id — passe um UUID de perfil de um membro para atribuir a conversa a um agente, ou null para desatribuir. Use GET /api/v1/members para descobrir os IDs.',
    es: 'Actualiza una conversación. Actualmente soporta assigned_agent_id — pase un UUID de perfil de un miembro para asignar la conversación a un agente, o null para desasignar. Use GET /api/v1/members para descubrir los IDs.',
    en: 'Update a conversation. Currently supports assigned_agent_id — pass a team member profile UUID to assign the conversation to an agent, or null to unassign. Use GET /api/v1/members to discover IDs.',
  },
  curl: `curl -X PATCH https://your-crm.example.com/api/v1/conversations/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "assigned_agent_id": "..." }'`,
  json: `{
  "data": {
    "id": "...",
    "status": "open",
    "assigned_agent_id": "...",
    "contact": { "id": "...", "phone": "+14155550123", "name": "Jane Doe" }
  }
}`,
};

const transferOwnership: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/account/transfer-ownership',
  scopes: ['webhooks:manage'],
  description: {
    pt: 'Transfere a propriedade da conta para outro membro. Requer o escopo webhooks:manage (privilégio administrativo máximo via API). new_owner_user_id deve ser o user_id (UUID do auth.users, não o id do perfil) do novo proprietário — use GET /api/v1/members para obter o user_id. O proprietário atual é rebaixado a admin.',
    es: 'Transfiere la propiedad de la cuenta a otro miembro. Requiere el alcance webhooks:manage (máximo privilegio administrativo vía API). new_owner_user_id debe ser el user_id (UUID de auth.users, no el id del perfil) del nuevo propietario — use GET /api/v1/members para obtener el user_id. El propietario actual se degrada a admin.',
    en: 'Transfer account ownership to another member. Requires the webhooks:manage scope (maximum admin privilege via API). new_owner_user_id must be the user_id (UUID from auth.users, not the profile id) of the new owner — use GET /api/v1/members to obtain the user_id. The current owner is demoted to admin.',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/account/transfer-ownership \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "new_owner_user_id": "..." }'`,
  json: `{
  "data": { "transferred": true }
}`,
  notes: ['This is an irreversible, audited action. Rate-limited to prevent abuse.'],
};

const mediaLibraryList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/media-library',
  scopes: ['media:read'],
  description: {
    pt: 'Lista os assets da biblioteca de mídia, do mais recente primeiro. Paginado. Filtros opcionais: ?search= (nome), ?tag=<tagId>, ?type= (image / video / document). Cada asset inclui suas tags. Use com POST /api/v1/messages para enviar mídia da biblioteca para um contato via n8n ou automação.',
    es: 'Lista los assets de la biblioteca de medios, del más reciente primero. Paginado. Filtros opcionales: ?search= (nombre), ?tag=<tagId>, ?type= (image / video / document). Cada asset incluye sus etiquetas. Úselo con POST /api/v1/messages para enviar medios de la biblioteca a un contacto vía n8n o automatización.',
    en: 'List media library assets, newest first. Paginated. Optional filters: ?search= (name), ?tag=<tagId>, ?type= (image / video / document). Each asset embeds its tags. Use with POST /api/v1/messages to send library media to a contact via n8n or automation.',
  },
  curl: `curl "https://your-crm.example.com/api/v1/media-library?tag=<tagId>&type=image&limit=50" \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    {
      "id": "...",
      "name": "Depoimento João - Antes e Depois",
      "caption": "Olha o resultado que o João teve!",
      "media_type": "image",
      "media_url": "https://...supabase.co/.../media-library/account-.../...-depoimento.png",
      "file_size": 245760,
      "tags": [
        { "id": "...", "name": "depoimento", "color": "#10b981" },
        { "id": "...", "name": "resultado", "color": "#f59e0b" }
      ],
      "created_at": "..."
    }
  ],
  "meta": { "next_cursor": "..." }
}`,
  details: [
    'Use the returned media_url directly in POST /api/v1/messages as the media_url field.',
    'The caption field is the pre-saved text that can be passed as content_text when sending.',
  ],
};

const mediaLibraryDetail: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/media-library/{id}',
  scopes: ['media:read'],
  description: {
    pt: 'Ler um asset específico da biblioteca de mídia. 404 se pertencer a outra conta.',
    es: 'Leer un asset específico de la biblioteca de medios. 404 si pertenece a otra cuenta.',
    en: 'Read a specific media library asset. 404 if it belongs to another account.',
  },
  curl: `curl https://your-crm.example.com/api/v1/media-library/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
};

const mediaLibraryTagsList: EndpointDoc = {
  method: 'GET',
  path: '/api/v1/media-library/tags',
  scopes: ['media:read'],
  description: {
    pt: 'Lista todas as tags da biblioteca de mídia da conta, ordenadas por nome. Use os IDs retornados no filtro ?tag= do endpoint de listagem de assets.',
    es: 'Lista todas las etiquetas de la biblioteca de medios de la cuenta, ordenadas por nombre. Use los IDs devueltos en el filtro ?tag= del endpoint de listado de assets.',
    en: "List all media library tags for the account, ordered by name. Use the returned IDs in the ?tag= filter on the assets list endpoint.",
  },
  curl: `curl https://your-crm.example.com/api/v1/media-library/tags \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": [
    { "id": "...", "name": "depoimento", "color": "#10b981" },
    { "id": "...", "name": "resultado", "color": "#f59e0b" },
    { "id": "...", "name": "produto", "color": "#3b82f6" }
  ]
}`,
};

const mediaLibraryTagsCreate: EndpointDoc = {
  method: 'POST',
  path: '/api/v1/media-library/tags',
  scopes: ['media:write'],
  description: {
    pt: 'Cria uma nova tag para organizar assets da biblioteca de mídia. name é obrigatório e deve ser único na conta. color é opcional (hex, ex: "#10b981").',
    es: 'Crea una nueva etiqueta para organizar assets de la biblioteca de medios. name es obligatorio y debe ser único en la cuenta. color es opcional (hex, ej: "#10b981").',
    en: 'Create a new tag for organizing media library assets. name is required and must be unique per account. color is optional (hex, e.g. "#10b981").',
  },
  curl: `curl -X POST https://your-crm.example.com/api/v1/media-library/tags \\
  -H "Authorization: Bearer wacrm_live_xxx" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "depoimento", "color": "#10b981" }'`,
  json: `{
  "data": { "id": "...", "name": "depoimento", "color": "#10b981" }
}`,
};

const mediaLibraryTagsDelete: EndpointDoc = {
  method: 'DELETE',
  path: '/api/v1/media-library/tags/{id}',
  scopes: ['media:write'],
  description: {
    pt: 'Remove uma tag da biblioteca de mídia. As associações com assets são removidas automaticamente (ON DELETE CASCADE).',
    es: 'Elimina una etiqueta de la biblioteca de medios. Las asociaciones con assets se eliminan automáticamente (ON DELETE CASCADE).',
    en: 'Delete a media library tag. Asset associations are removed automatically (ON DELETE CASCADE).',
  },
  curl: `curl -X DELETE https://your-crm.example.com/api/v1/media-library/tags/{id} \\
  -H "Authorization: Bearer wacrm_live_xxx"`,
  json: `{
  "data": { "deleted": true }
}`,
};

export const endpoints: EndpointDoc[] = [
  me,
  messages,
  instagramMessages,
  contactsList,
  contactsCreate,
  contactsDetail,
  conversationsList,
  conversationsDetail,
  conversationsMessages,
  conversationsAssign,
  broadcastsCreate,
  broadcastsDetail,
  pipelinesList,
  pipelinesCreate,
  pipelinesDetail,
  pipelinesStages,
  stagesDetail,
  dealsList,
  dealsCreate,
  dealsDetail,
  dealsMove,
  dealsStatus,
  webhooksList,
  webhooksDetail,
  membersList,
  membersDetail,
  transferOwnership,
  mediaLibraryList,
  mediaLibraryDetail,
  mediaLibraryTagsList,
  mediaLibraryTagsCreate,
  mediaLibraryTagsDelete,
];

export const statusCodes: string[][] = [
  ['401', 'unauthorized', 'Missing / malformed / unknown / revoked / expired key'],
  ['403', 'forbidden', 'Valid key, but missing the required scope'],
  ['429', 'rate_limited', 'Per-key rate limit exceeded'],
  ['400', 'bad_request', 'Malformed input'],
  ['404', 'not_found', 'No such resource'],
  ['500', 'internal', 'Server error'],
];

export const scopeRows: string[][] = [
  ['messages:send', 'Send WhatsApp messages'],
  ['messages:read', 'Read messages and delivery status'],
  ['contacts:read', 'List and read contacts'],
  ['contacts:write', 'Create and update contacts'],
  ['conversations:read', 'List and read conversations'],
  ['conversations:write', 'Update conversations (assign agents, change status)'],
  ['broadcasts:send', 'Launch broadcast campaigns'],
  ['webhooks:manage', 'Register and manage outbound event webhooks'],
  ['pipelines:read', 'List and read pipelines and stages'],
  ['pipelines:write', 'Create, update, and delete pipelines and stages'],
  ['deals:read', 'List and read deals'],
  ['deals:write', 'Create, update, delete deals, move, change status'],
  ['members:read', 'List and read team members and their roles'],
  ['media:read', 'List and read media library assets and tags'],
  ['media:write', 'Upload and delete media library assets, create and delete tags'],
];

export const webhookEvents: string[][] = [
  ['message.received', 'An inbound message arrives from a contact. Includes channel + provider fields to identify the source.'],
  ['message.status_updated', 'A message you sent changed delivery status. Includes channel + provider.'],
  ['conversation.created', 'A new conversation is opened for a contact. Includes channel + provider.'],
];

export const channelProviderTable: string[][] = [
  ['channel', 'whatsapp / instagram', 'The channel the message arrived on'],
  ['provider', 'meta / ryzeapi', 'For WhatsApp: which backend provider delivered the message. Omitted for Instagram.'],
];

export const authSteps: string[][] = [
  ['1.', 'Give the key a name (after the integration that will use it).'],
  ['2.', 'Grant the scopes it needs — nothing more.'],
  ['3.', 'Copy the key. The full key is shown exactly once. wacrm stores only a SHA-256 hash, so it can never be shown again. If you lose it, revoke it and create a new one.'],
];

export const paginationExample = `GET /api/v1/contacts?limit=50
→ { "data": [ ... ], "meta": { "next_cursor": "eyJ..." } }

GET /api/v1/contacts?limit=50&cursor=eyJ...
→ { "data": [ ... ], "meta": { "next_cursor": null } }   // last page`;

export const deliveryPayload = `{
  "id": "8f3c...",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "...",
  "data": {
    "conversation_id": "...",
    "contact_id": "...",
    "whatsapp_message_id": "wamid....",
    "content_type": "text",
    "text": "Hi 👋",
    "channel": "whatsapp",
    "provider": "meta"
  }
}`;

export const webhookManageSteps: string[][] = [
  ['POST /api/v1/webhooks', 'Register { "url": "https://...", "events": ["message.received"] }. url must be https://. Response includes secret exactly once.'],
  ['GET /api/v1/webhooks', 'List your endpoints (never returns the secret).'],
  ['GET /api/v1/webhooks/{id}', 'Read one.'],
  ['PATCH /api/v1/webhooks/{id}', 'Update url, events, or is_active (re-enabling clears the failure counter).'],
  ['DELETE /api/v1/webhooks/{id}', 'Remove one.'],
];

export const verifyExample = `const [, t, v1] = header.match(/t=(\\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(\`\${t}.\${rawBody}\`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));`;

export const successEnvelope = `// success
{ "data": { /* ... */ } }`;

export const errorEnvelope = `// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }`;
