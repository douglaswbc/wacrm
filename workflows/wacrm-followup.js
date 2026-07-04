import {
  workflow,
  node,
  trigger,
  ifElse,
  switchCase,
  splitInBatches,
  nextBatch,
  sticky,
  expr,
  placeholder,
  newCredential,
} from "@n8n/workflow-sdk";

// ============================================================
// WACRM - FOLLOW-UP AUTOMATICO DE VENDAS
//
// Agenda: a cada 1 hora
// Verifica pagamentos pendentes ha mais de N horas e envia
// lembretes progressivos ao cliente.
//
// Regras de follow-up:
//   4h sem pagar  → 1o lembrete (cortesia)
//   24h sem pagar → 2o lembrete (urgente)
//   48h sem pagar → 3o lembrete + aviso de expiracao
// ============================================================

const schedule = trigger({
  type: "n8n-nodes-base.scheduleTrigger",
  version: 1.3,
  config: {
    name: "Schedule (1 hora)",
    parameters: {
      rule: {
        interval: [
          { field: "hours", hoursInterval: 1, triggerAtMinute: 0 },
        ],
      },
    },
    position: [240, 300],
  },
  output: [{}],
});

const fetchPending = node({
  type: "n8n-nodes-base.dataTable",
  version: 1.1,
  config: {
    name: "Buscar Pendentes",
    parameters: {
      resource: "row",
      operation: "get",
      dataTableId: { mode: "id", value: "2DKcXyjaEhczwgsA" },
      matchType: "allConditions",
      filters: {
        conditions: [
          { keyName: "status", condition: "eq", keyValue: "pending" },
        ],
      },
      returnAll: true,
      orderBy: true,
      orderByColumn: "createdAt",
      orderByDirection: "ASC",
    },
    alwaysOutputData: true,
    position: [540, 300],
  },
  output: [{ id: 1, payment_id: "", contact_phone: "", contact_name: "", amount: 0, status: "pending", reminder_count: 0, createdAt: "" }],
});

// --------------------------------------------------
// Calculate hours since creation
// --------------------------------------------------

const calcHours = node({
  type: "n8n-nodes-base.set",
  version: 3.4,
  config: {
    name: "Calcular Idade",
    parameters: {
      mode: "manual",
      includeOtherFields: true,
      assignments: {
        assignments: [
          {
            id: "a",
            name: "horas_desde_criacao",
            value: expr("{{ $now.diff($json.createdAt, 'hours').hours }}"),
            type: "number",
          },
        ],
      },
    },
    position: [840, 300],
  },
  output: [{ horas_desde_criacao: 0 }],
});

// --------------------------------------------------
// Route by reminder stage
// --------------------------------------------------

const routeStage = switchCase({
  version: 3.4,
  config: {
    name: "Estagio do Follow-up",
    parameters: {
      mode: "rules",
      rules: {
        values: [
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "0", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "Nunca lembrado",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "1", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "ja lembrado 1x",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "2", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "ja lembrado 2x",
          },
        ],
      },
      options: { fallbackOutput: "extra" },
    },
    position: [1140, 300],
  },
  output: [{}, {}, {}, {}],
});

// --------------------------------------------------
// IF: minimum hours elapsed for this stage?
// --------------------------------------------------

const checkEligible = ifElse({
  version: 2.3,
  config: {
    name: "Pode lembrar?",
    parameters: {
      conditions: {
        combinator: "and",
        options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
        conditions: [
          {
            leftValue: expr("{{ $json.horas_desde_criacao }}"),
            rightValue: expr("{{ $json.reminder_count === 0 ? 4 : $json.reminder_count === 1 ? 24 : 48 }}"),
            operator: { type: "number", operation: "largerEqual" },
          },
        ],
      },
    },
    position: [1440, 300],
  },
  output: [{}, {}],
});

// --------------------------------------------------
// SEND LEMBRETE
// --------------------------------------------------

const chooseMessage = switchCase({
  version: 3.4,
  config: {
    name: "Escolher Mensagem",
    parameters: {
      mode: "rules",
      rules: {
        values: [
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "0", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "1o lembrete",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "1", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "2o lembrete",
          },
          {
            conditions: {
              combinator: "and",
              options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
              conditions: [{ leftValue: expr("{{ $json.reminder_count }}"), rightValue: "2", operator: { type: "number", operation: "equals" } }],
            },
            renameOutput: true, outputKey: "3o lembrete",
          },
        ],
      },
      options: { fallbackOutput: "extra" },
    },
    position: [1740, 200],
  },
  output: [{}, {}, {}, {}],
});

const msg1 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "1o Lembrete (4h)",
    parameters: {
      method: "POST",
      url: placeholder("https://crm.seudominio.com/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $json.contact_phone }}",\n' +
        '  "text": "Ola {{ $json.contact_name }}! 😊\\n\\nVi que voce iniciou a compra, mas ainda nao finalizou o pagamento.\\n\\nSeu link de pagamento esta disponivel. Qualquer duvida, estamos aqui!"\n' +
        '}',
      ),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [2040, 20],
  },
  output: [{ data: {} }],
});

const msg2 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "2o Lembrete (24h)",
    parameters: {
      method: "POST",
      url: placeholder("https://crm.seudominio.com/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $json.contact_phone }}",\n' +
        '  "text": "Ola {{ $json.contact_name }}! \\n\\nAinda estamos aguardando seu pagamento. O link continua disponivel para voce finalizar.\\n\\nSe preferir, podemos ajudar com outra forma de pagamento. É so responder essa mensagem!"\n' +
        '}',
      ),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [2040, 150],
  },
  output: [{ data: {} }],
});

const msg3 = node({
  type: "n8n-nodes-base.httpRequest",
  version: 4.4,
  config: {
    name: "3o Lembrete (48h)",
    parameters: {
      method: "POST",
      url: placeholder("https://crm.seudominio.com/api/v1/messages"),
      authentication: "genericCredentialType",
      genericAuthType: "httpBearerAuth",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Content-Type", value: "application/json" }] },
      sendBody: true,
      contentType: "json",
      specifyBody: "json",
      jsonBody: expr(
        '{\n' +
        '  "to": "{{ $json.contact_phone }}",\n' +
        '  "text": "Ola {{ $json.contact_name }}! \\n\\nEste e um aviso importante: seu link de pagamento expirara em breve.\\n\\nAcesse agora para garantir sua compra: {{ $json.payment_url }}\\n\\nSe ja pagou, desconsidere esta mensagem."\n' +
        '}',
      ),
      options: { timeout: 10000, response: { response: { responseFormat: "json" } } },
    },
    credentials: { httpBearerAuth: newCredential("WACRM API") },
    executeOnce: true,
    position: [2040, 280],
  },
  output: [{ data: {} }],
});

const incrementReminder = node({
  type: "n8n-nodes-base.dataTable",
  version: 1.1,
  config: {
    name: "Incrementar Contador",
    parameters: {
      resource: "row",
      operation: "update",
      dataTableId: { mode: "id", value: "2DKcXyjaEhczwgsA" },
      matchType: "allConditions",
      filters: {
        conditions: [
          { keyName: "id", condition: "eq", keyValue: expr("{{ $json.id }}") },
        ],
      },
      columns: expr(
        '{\n' +
        '  "mappingMode": "defineBelow",\n' +
        '  "value": [\n' +
        '    { "column": "reminder_count", "value": "{{ $json.reminder_count + 1 }}" },\n' +
        '    { "column": "last_checked_at", "value": "{{ $now.toISO() }}" }\n' +
        '  ]\n' +
        '}',
      ),
    },
    alwaysOutputData: true,
    position: [2040, 430],
  },
  output: [{ id: 1 }],
});

export default workflow("wacrm-followup", "WACRM - Follow-up de Vendas")
  .add(sticky("## WACRM - Follow-up de Vendas\n\nExecuta a cada 1 hora. Regras:\n- **4h sem pagar** → 1o lembrete amigavel\n- **24h sem pagar** → 2o lembrete com oferta de ajuda\n- **48h sem pagar** → 3o lembrete com aviso de expiracao\n\nIncrementa `reminder_count` a cada envio."))
  .add(schedule)
  .to(fetchPending)
  .to(calcHours)
  .to(checkEligible
    .onTrue(routeStage
      .onCase(0, chooseMessage
        .onCase(0, msg1.to(incrementReminder))
        .onCase(1, msg2.to(incrementReminder))
        .onCase(2, msg3.to(incrementReminder)),
      )
      .onCase(1, chooseMessage
        .onCase(0, msg1.to(incrementReminder))
        .onCase(1, msg2.to(incrementReminder))
        .onCase(2, msg3.to(incrementReminder)),
      )
      .onCase(2, chooseMessage
        .onCase(0, msg1.to(incrementReminder))
        .onCase(1, msg2.to(incrementReminder))
        .onCase(2, msg3.to(incrementReminder)),
      ),
    )
    .onFalse(node({ type: "n8n-nodes-base.noOp", version: 1, config: { name: "Aguardar" }, position: [1740, 430] })),
  );
