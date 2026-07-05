import {
  workflow,
  node,
  trigger,
  tool,
  languageModel,
  memory,
  sticky,
  expr,
  placeholder,
  newCredential,
} from "@n8n/workflow-sdk";

// ============================================================
// WACRM - AI AGENT (Atendente Inteligente)
//
// Fluxo:
//   1. Recebe webhook do wacrm (automacao new_message_received)
//   2. Enriquece dados (conversa + contato via API do wacrm)
//   3. AI Agent analisa e responde com ferramentas
//
// Tools disponiveis:
//   - Enviar WhatsApp (wacrm API)
//   - Criar cobranca (Mercado Pago)
//   - Verificar pagamento (Mercado Pago)
//   - Mover pipeline (Supabase)
//   - Adicionar tag (Supabase)
//   - Buscar contato (wacrm API)
// ============================================================

// --------------------------------------------------
// 1. WEBHOOK
// --------------------------------------------------

const webhook = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "Webhook wacrm",
    parameters: {
      httpMethod: "POST",
      path: "wacrm-ai-agent",
      responseMode: "lastNode",
      options: { responseCode: { values: { responseCode: 200 } } },
    },
    position: [240, 300],
  },
  output: [{ body: { message_text: "", conversation_id: "" } }],
});

// --------------------------------------------------
// 2. ENRIQUECER DADOS
// --------------------------------------------------

const fetchConversation = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Conversa",
    parameters: {
      method: "GET",
      url: expr('{{ $("Webhook wacrm").item.json.body.conversation_id }}'),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [540, 300],
  },
  output: [{ data: { id: "", contact_id: "", status: "", assigned_agent_id: "" } }],
});

const fetchContact = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Contato",
    parameters: {
      method: "GET",
      url: expr('{{ $("Buscar Conversa").item.json.data.contact_id }}'),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [840, 300],
  },
  output: [{ data: { id: "", name: "", phone: "" } }],
});

const fetchMessages = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Historico",
    parameters: {
      method: "GET",
      url: expr('{{ $("Webhook wacrm").item.json.body.conversation_id }}/messages?limit=20'),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [1080, 300],
  },
  output: [{ data: [{ id: "", content_type: "", text: "", sender_type: "", created_at: "" }] }],
});

const normalize = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Preparar Contexto",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          { id: "a", name: "conversation_id", value: expr("{{ $('Webhook wacrm').item.json.body.conversation_id }}"), type: "string" },
          { id: "b", name: "message_text", value: expr("{{ $('Webhook wacrm').item.json.body.message_text }}"), type: "string" },
          { id: "c", name: "contact_name", value: expr("{{ $('Buscar Contato').item.json.data.name }}"), type: "string" },
          { id: "d", name: "contact_phone", value: expr("{{ $('Buscar Contato').item.json.data.phone }}"), type: "string" },
          { id: "e", name: "contact_id", value: expr("{{ $('Buscar Contato').item.json.data.id }}"), type: "string" },
          { id: "f", name: "assigned_agent", value: expr("{{ $('Buscar Conversa').item.json.data.assigned_agent_id }}"), type: "string" },
        ],
      },
    },
    position: [1320, 300],
  },
  output: [{ conversation_id: "", message_text: "", contact_name: "", contact_phone: "", contact_id: "", assigned_agent: "" }],
});

// --------------------------------------------------
// 3. AI AGENT
// --------------------------------------------------

const openaiModel = languageModel({
  type: "@n8n/n8n-nodes-langchain.lmChatOpenAi",
  version: 1.3,
  config: {
    name: "OpenAI",
    parameters: { model: { mode: "list", value: "gpt-5-mini" }, options: { temperature: 0.7 } },
    credentials: { openAiApi: newCredential("OpenAI") },
    position: [540, 500],
  },
});

const sessionMemory = memory({
  type: "@n8n/n8n-nodes-langchain.memoryBufferWindow",
  version: 1.3,
  config: {
    name: "Memoria",
    parameters: {
      sessionIdType: "customKey",
      sessionKey: expr("{{ $('Preparar Contexto').item.json.conversation_id }}"),
      contextWindowLength: 10,
    },
    position: [780, 500],
  },
});

// --- TOOLS ---

const toolSendMessage = tool({
  type: "n8n-nodes-base.httpRequestTool",
  version: 4.4,
  config: {
    name: "Enviar WhatsApp",
    parameters: {
      method: "POST",
      url: placeholder("https://wacrm.autofunil.com.br/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr('{\n  "to": "{{ $fromAI("phone", "Phone number") }}",\n  "type": "text",\n  "text": "{{ $fromAI("text", "Message body") }}"\n}'),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    position: [1680, 100],
  },
});

const toolCreateCharge = tool({
  type: "n8n-nodes-base.httpRequestTool",
  version: 4.4,
  config: {
    name: "Criar Cobranca MP",
    parameters: {
      method: "POST",
      url: "https://api.mercadopago.com/checkout/preferences",
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr('{\n  "items": [{\n    "title": "{{ $fromAI("description", "Service description") }}",\n    "quantity": 1,\n    "unit_price": {{ $fromAI("amount", "Price") }},\n    "currency_id": "BRL"\n  }],\n  "payer": { "name": "{{ $fromAI("customer_name", "Customer name") }}" },\n  "back_urls": { "success": "https://wacrm.autofunil.com.br/", "failure": "https://wacrm.autofunil.com.br/", "pending": "https://wacrm.autofunil.com.br/" },\n  "auto_return": "approved",\n  "external_reference": "{{ $fromAI("conversation_id", "Conversation ID") }}"\n}'),
      options: { timeout: 15000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Mercado Pago") },
    position: [1680, 250],
  },
});

const toolCheckPayment = tool({
  type: "n8n-nodes-base.httpRequestTool",
  version: 4.4,
  config: {
    name: "Verificar Pagamento",
    parameters: {
      method: "GET",
      url: expr('https://api.mercadopago.com/v1/payments/search?external_reference={{ $fromAI("conversation_id", "Conversation ID") }}&sort=date_created&criteria=desc'),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Mercado Pago") },
    position: [1680, 400],
  },
});

const toolMovePipeline = tool({
  type: "@n8n/n8n-nodes-langchain.toolCode",
  version: 1.3,
  config: {
    name: "Mover Pipeline",
    description: "Move a deal to a new pipeline stage. Stages: new_lead, qualified, proposal_sent, negotiation, won, lost",
    language: "javaScript",
    specifyInputSchema: true,
    schemaType: "fromJson",
    jsonSchemaExample: '{\n  "deal_id": "uuid",\n  "stage": "qualified"\n}',
    jsCode: `
const dealId = parameters.deal_id;
const stage = parameters.stage;

const stageMap = {
  "new_lead": 1,
  "qualified": 2,
  "proposal_sent": 3,
  "negotiation": 4,
  "won": 5,
  "lost": 6
};

const stageId = stageMap[stage];
if (!stageId) return "Invalid stage: " + stage;

const supabaseUrl = "PLACEHOLDER_SUPABASE_URL";
const supabaseKey = "PLACEHOLDER_SUPABASE_SERVICE_KEY";

const response = await fetch(supabaseUrl + "/rest/v1/deals?id=eq." + dealId, {
  method: "PATCH",
  headers: {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": "Bearer " + supabaseKey
  },
  body: JSON.stringify({ stage_id: stageId, updated_at: new Date().toISOString() })
});

if (!response.ok) {
  return "Error updating deal: " + response.status;
}

return "Deal moved to " + stage + " successfully";
`,
    position: [1680, 550],
  },
});

const toolAddTag = tool({
  type: "@n8n/n8n-nodes-langchain.toolCode",
  version: 1.3,
  config: {
    name: "Adicionar Tag",
    description: "Add a tag to a contact. Requires contact_id and tag_id. Common tags: interested, botox, cleaning, payment_pending, payment_confirmed",
    language: "javaScript",
    specifyInputSchema: true,
    schemaType: "fromJson",
    jsonSchemaExample: '{\n  "contact_id": "uuid",\n  "tag_id": "uuid"\n}',
    jsCode: `
const contactId = parameters.contact_id;
const tagId = parameters.tag_id;

const supabaseUrl = "PLACEHOLDER_SUPABASE_URL";
const supabaseKey = "PLACEHOLDER_SUPABASE_SERVICE_KEY";

const response = await fetch(supabaseUrl + "/rest/v1/contact_tags", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "apikey": supabaseKey,
    "Authorization": "Bearer " + supabaseKey
  },
  body: JSON.stringify({
    contact_id: contactId,
    tag_id: tagId
  })
});

if (!response.ok) {
  const err = await response.text();
  return "Error adding tag: " + err;
}

return "Tag added successfully";
`,
    position: [1680, 700],
  },
});

const toolGetContact = tool({
  type: "n8n-nodes-base.httpRequestTool",
  version: 4.4,
  config: {
    name: "Buscar Contato API",
    parameters: {
      method: "GET",
      url: expr('https://wacrm.autofunil.com.br/api/v1/contacts/{{ $fromAI("contact_id", "Contact ID") }}'),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    position: [1680, 850],
  },
});

const aiAgent = node({
  type: "@n8n/n8n-nodes-langchain.agent",
  version: 3.1,
  config: {
    name: "AI Atendente",
    subnodes: {
      model: openaiModel,
      memory: sessionMemory,
      tools: [
        toolSendMessage,
        toolCreateCharge,
        toolCheckPayment,
        toolMovePipeline,
        toolAddTag,
        toolGetContact,
      ],
    },
    parameters: {
      promptType: "define",
      text: expr("{{ $('Preparar Contexto').item.json.message_text }}"),
      options: {
        systemMessage: expr('Voce e a assistente virtual da Clinica de Estetica.\n\nSEU NOME: Use "Ana" para se apresentar.\n\nTOM: Profissional, acolhedor, entusiasta. Responda em portugues brasileiro.\n\nSERVICOS:\n- Botox (toxina botulinica): R$ 990\n- Limpeza de pele: R$ 200\n\nCONTATO ATUAL:\nNome: {{ $("Preparar Contexto").item.json.contact_name }}\nTelefone: {{ $("Preparar Contexto").item.json.contact_phone }}\n\nFLUXO DE VENDAS:\n1. CUMPRIMENTO - Se apresente e pergunte como pode ajudar\n2. QUALIFICACAO - Pergunte o que esta procurando\n3. RECOMENDACAO - Sugira o servico adequado\n4. FECHAMENTO - Use Criar Cobranca MP\n5. POS-VENDA - Parabenize e ofereca agendamento\n\nFERRAMENTAS:\n- Enviar WhatsApp: Use SEMPRE\n- Criar Cobranca MP\n- Verificar Pagamento\n- Mover Pipeline\n- Adicionar Tag\n\nUse SEMPRE Enviar WhatsApp para responder.'),
        maxIterations: 15,
      },
    },
    position: [1620, 300],
  },
  output: [{ output: "AI response" }],
});

// ============================================================
// COMPOSE
// ============================================================

export default workflow("wacrm-ai-agent", "WACRM - AI Atendente Inteligente")
  .add(sticky("## WACRM - AI Atendente\n\nRecebe mensagens do wacrm via webhook, enriquece com dados do contato e historico, e usa AI Agent (OpenAI) para responder.\n\n### Ferramentas:\n1. Enviar WhatsApp (wacrm API)\n2. Criar Cobranca MP\n3. Verificar Pagamento\n4. Mover Pipeline\n5. Adicionar Tag\n6. Buscar Contato API"))

  .add(webhook)
  .to(fetchConversation)
  .to(fetchContact)
  .to(fetchMessages)
  .to(normalize)
  .to(aiAgent);
