import {
  workflow,
  node,
  trigger,
  ifElse,
  splitInBatches,
  nextBatch,
  sticky,
  expr,
  placeholder,
  newCredential,
} from "@n8n/workflow-sdk";

// ============================================================
// WACRM - VERIFICADOR DE PAGAMENTOS (Mercado Pago)
//
// A cada 5 min, busca pagamentos aprovados no Mercado Pago
// e notifica o cliente via WhatsApp.
// ============================================================

const schedule = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.3,
  config: {
    name: "Schedule (5 min)",
    parameters: {
      rule: { interval: [{ field: "minutes", minutesInterval: 5 }] },
    },
    position: [240, 300],
  },
  output: [{}],
});

const searchPayments = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Buscar Pagamentos MP",
    parameters: {
      method: "GET",
      url: placeholder("https://api.mercadopago.com/v1/payments/search?sort=date_created&criteria=desc&limit=50"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      options: { timeout: 15000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Mercado Pago") },
    alwaysOutputData: true,
    position: [540, 300],
  },
  output: [{ results: [{ id: "", status: "", external_reference: "", date_approved: "" }] }],
});

const checkApproved = ifElse({
  version: 2.3,
  config: {
    name: "Foi aprovado?",
    parameters: {
      conditions: {
        combinator: "or",
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [
          { leftValue: expr("{{ $json.status }}"), rightValue: "approved", operator: { type: "string", operation: "equals" } },
        ],
      },
    },
    position: [840, 200],
  },
  output: [{}, {}],
});

const notifyApproved = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "Notificar Pagamento",
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
      jsonBody: expr('{\n  "to": "{{ $json.external_reference }}",\n  "text": "Pagamento confirmado! Obrigado pela compra 🎉"\n}'),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("Mercado Pago") },
    executeOnce: true,
    position: [1140, 100],
  },
  output: [{ data: {} }],
});

const sibNode = splitInBatches({
  version: 3,
  config: {
    name: "Processar Lote",
    parameters: { batchSize: 10 },
    position: [840, 300],
  },
});

export default workflow("wacrm-payment-checker", "WACRM - Verificador de Pagamentos")
  .add(sticky("## WACRM - Verificador de Pagamentos (Mercado Pago)\n\nExecuta a cada 5 minutos.\n1. Busca pagamentos recentes no Mercado Pago\n2. Filtra os aprovados\n3. Notifica o cliente via WhatsApp"))
  .add(schedule)
  .to(searchPayments)
  .to(sibNode
    .onDone(node({ type: "n8n-nodes-base.noOp", version: 1, config: { name: "Fim" }, position: [1140, 400] }))
    .onEachBatch(checkApproved
      .onTrue(notifyApproved)
      .onFalse(nextBatch(sibNode)),
    ),
  );
