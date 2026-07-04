import {
  workflow,
  node,
  trigger,
  switchCase,
  sticky,
  expr,
  placeholder,
  newCredential,
} from "@n8n/workflow-sdk";

// ============================================================
// WACRM - ORQUESTRADOR DE PAGAMENTOS
//
// Fluxo:
//   1. Recebe webhook do wacrm (message_text + conversation_id)
//      via URL: /webhook/wacrm-payment?action=generate_charge
//   2. Busca conversa na API do wacrm (conversation_id)
//   3. Busca contato na API do wacrm (contact_id)
//   4. Roteia pela action passada na query string
//
// Configuracao na automacao do wacrm (step send_webhook):
//   URL: https://editor.autofunil.com.br/webhook/wacrm-payment?action=generate_charge
//   body_template: deixe VAZIO (envia message_text + conversation_id automaticamente)
//
// Actions disponiveis:
//   generate_charge → criar cobranca + enviar link
//   check_payment   → verificar status + notificar
//   send_media      → enviar midia
// ============================================================

// --------------------------------------------------
// 1. WEBHOOK TRIGGER
// --------------------------------------------------

const webhook = trigger({
  type: "n8n-nodes-base.webhook",
  version: 2.1,
  config: {
    name: "Webhook wacrm",
    parameters: {
      httpMethod: "POST",
      path: "wacrm-payment",
      responseMode: "lastNode",
      options: { responseCode: { values: { responseCode: 200 } } },
    },
    position: [240, 300],
  },
  output: [
    {
      query: { action: "" },
      body: { message_text: "", conversation_id: "" },
    },
  ],
});

// --------------------------------------------------
// 2. BUSCAR CONVERSA NA API DO WACRM
// --------------------------------------------------

const fetchConversation = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Conversa (API)",
    parameters: {
      method: "GET",
      url: expr(
        '{{ $("Webhook wacrm").item.json.body.conversation_id }}',
      ),
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }],
      },
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: {
        timeout: 10000,
        response: { response: { responseFormat: "json" } },
      },
    },
    credentials: { httpHeaderAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [540, 300],
  },
  output: [{ data: { id: "", contact_id: "", status: "" } }],
});

// --------------------------------------------------
// 3. BUSCAR CONTATO NA API DO WACRM
// --------------------------------------------------

const fetchContact = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Contato (API)",
    parameters: {
      method: "GET",
      url: expr(
        '{{ $("Buscar Conversa (API)").item.json.data.contact_id }}',
      ),
      sendHeaders: true,
      headerParameters: {
        parameters: [{ name: "Content-Type", value: "application/json" }],
      },
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      options: {
        timeout: 10000,
        response: { response: { responseFormat: "json" } },
      },
    },
    credentials: { httpHeaderAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [840, 300],
  },
  output: [{ data: { id: "", name: "", phone: "" } }],
});

// --------------------------------------------------
// 4. NORMALIZAR DADOS
// --------------------------------------------------

const normalize = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Normalizar Dados",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: "a",
            name: "action",
            value: expr("{{ $('Webhook wacrm').item.json.query.action }}"),
            type: "string",
          },
          {
            id: "b",
            name: "contact_name",
            value: expr("{{ $('Buscar Contato (API)').item.json.data.name }}"),
            type: "string",
          },
          {
            id: "c",
            name: "contact_phone",
            value: expr("{{ $('Buscar Contato (API)').item.json.data.phone }}"),
            type: "string",
          },
          {
            id: "d",
            name: "contact_id",
            value: expr("{{ $('Buscar Contato (API)').item.json.data.id }}"),
            type: "string",
          },
          {
            id: "e",
            name: "conversation_id",
            value: expr("{{ $('Webhook wacrm').item.json.body.conversation_id }}"),
            type: "string",
          },
          {
            id: "f",
            name: "message_text",
            value: expr("{{ $('Webhook wacrm').item.json.body.message_text }}"),
            type: "string",
          },
        ],
      },
    },
    position: [1140, 300],
  },
  output: [
    {
      action: "",
      contact_name: "",
      contact_phone: "",
      contact_id: "",
      conversation_id: "",
      message_text: "",
    },
  ],
});

// --------------------------------------------------
// 5. ROTEAR POR ACTION
// --------------------------------------------------

const router = switchCase({
  version: 3.4,
  config: {
    name: "Roteador",
    parameters: {
      mode: "rules",
      rules: {
        values: [
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [
                { leftValue: expr("{{ $('Normalizar Dados').item.json.action }}"), rightValue: "generate_charge", operator: { type: "string", operation: "equals" } },
              ],
            },
            renameOutput: true, outputKey: "Gerar Cobranca",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [
                { leftValue: expr("{{ $('Normalizar Dados').item.json.action }}"), rightValue: "check_payment", operator: { type: "string", operation: "equals" } },
              ],
            },
            renameOutput: true, outputKey: "Verificar Pagamento",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [
                { leftValue: expr("{{ $('Normalizar Dados').item.json.action }}"), rightValue: "send_media", operator: { type: "string", operation: "equals" } },
              ],
            },
            renameOutput: true, outputKey: "Enviar Midia",
          },
        ],
      },
      options: { fallbackOutput: "extra" },
    },
    position: [1440, 300],
  },
  output: [{}, {}, {}, {}],
});

// ============================================================
// BRANCH A: generate_charge
// ============================================================

const chargeApi = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Criar Cobranca",
    parameters: {
      method: "POST",
      url: placeholder("https://api.asaas.com/v3/payments"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "customer": "{{ $("Normalizar Dados").item.json.contact_name }}",\n' +
        '  "value": {{ $("Normalizar Dados").item.json.custom_data.amount }},\n' +
        '  "description": "{{ $("Normalizar Dados").item.json.custom_data.description }}"\n' +
        '}',
      ),
      options: { timeout: 15000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Gateway Pagamento") },
    executeOnce: true,
    position: [1740, 50],
  },
  output: [{ id: "", invoiceUrl: "", status: "" }],
});

const sendLink = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Enviar Link",
    parameters: {
      method: "POST",
      url: placeholder("https://wacrm.autofunil.com.br/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $("Normalizar Dados").item.json.contact_phone }}",\n' +
        '  "text": "Segue seu link de pagamento:\n{{ $("Criar Cobranca").item.json.invoiceUrl }}"\n' +
        '}',
      ),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpHeaderAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [2040, 50],
  },
  output: [{ data: {} }],
});

// ============================================================
// BRANCH B: check_payment
// ============================================================

const checkStatus = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Consultar Status",
    parameters: {
      method: "GET",
      url: placeholder("https://api.asaas.com/v3/payments/{payment_id}"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Gateway Pagamento") },
    executeOnce: true,
    position: [1740, 200],
  },
  output: [{ id: "", status: "", paidDate: "" }],
});

const notifyPaid = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Notificar Confirmacao",
    parameters: {
      method: "POST",
      url: placeholder("https://wacrm.autofunil.com.br/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $("Normalizar Dados").item.json.contact_phone }}",\n' +
        '  "text": "Pagamento confirmado! Obrigado pela compra 🎉"\n' +
        '}',
      ),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpHeaderAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [2040, 200],
  },
  output: [{ data: {} }],
});

// ============================================================
// BRANCH C: send_media
// ============================================================

const sendMedia = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Enviar Midia",
    parameters: {
      method: "POST",
      url: placeholder("https://wacrm.autofunil.com.br/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpHeaderAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $("Normalizar Dados").item.json.contact_phone }}",\n' +
        '  "type": "image",\n' +
        '  "media_url": "{{ $("Normalizar Dados").item.json.custom_data.media_url }}",\n' +
        '  "text": ""\n' +
        '}',
      ),
      options: { timeout: 15000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpHeaderAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [1740, 350],
  },
  output: [{ data: {} }],
});

// ============================================================
// COMPOSE
// ============================================================

export default workflow("wacrm-payment-orchestrator", "WACRM - Orquestrador de Pagamentos")
  .add(sticky("## WACRM - Orquestrador de Pagamentos\n\n### Fluxo\n1. Recebe webhook do wacrm (message_text + conversation_id)\n2. Busca conversa na API do wacrm\n3. Busca contato na API do wacrm\n4. Roteia pela action na query string\n\n### Config na automacao do wacrm\n- **URL:** `https://editor.autofunil.com.br/webhook/wacrm-payment?action=generate_charge`\n- **body_template:** deixe vazio\n\nTroque `generate_charge` por `check_payment` ou `send_media` conforme o cenario.\n\n### Credenciais necessarias\n- WACRM API (Header Auth)\n- Gateway Pagamento (Bearer Auth)"))
  .add(webhook)
  .to(fetchConversation)
  .to(fetchContact)
  .to(normalize)
  .to(router
    .onCase(0, chargeApi.to(sendLink))
    .onCase(1, checkStatus.to(notifyPaid))
    .onCase(2, sendMedia),
  );
