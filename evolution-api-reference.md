# Evolution API v2 - Referência de Curls

Referência completa das curls diretas para a API REST do Evolution Go (Whatsmeow).
Não depende do WACRM - pronto para replicar em qualquer sistema.

## Variáveis de Ambiente Necessárias

```bash
export EVOLUTION_URL="https://sua-evolution-server.com"
export EVOLUTION_ADMIN_KEY="sua-admin-apikey"
export INSTANCE_TOKEN="token-da-instancia"
export INSTANCE_NAME="nome-da-instancia"
```

---

## 1. GERENCIAMENTO DE INSTÂNCIAS (Admin Key)

### Criar Instância
```bash
curl -X POST "${EVOLUTION_URL}/instance/create" \
  -H "Content-Type: application/json" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}" \
  -d '{
    "name": "minha-instancia",
    "token": "token-unico-da-instancia",
    "webhook": "https://seu-sistema.com/webhook/evolution"
  }'
```

### Listar Todas as Instâncias
```bash
curl -X GET "${EVOLUTION_URL}/instance/all" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}"
```

### Deletar Instância
```bash
curl -X DELETE "${EVOLUTION_URL}/instance/delete/${INSTANCE_ID}" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}"
```

**Nota:** `INSTANCE_ID` é o UUID retornado na criação (campo `data.instanceId`).

---

## 2. OPERAÇÕES DA INSTÂNCIA (Instance Token)

### Conectar Instância (configurar webhook)
```bash
curl -X POST "${EVOLUTION_URL}/instance/connect" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "immediate": true,
    "webhookUrl": "https://seu-sistema.com/webhook/evolution"
  }'
```

### Obter QR Code
```bash
curl -X GET "${EVOLUTION_URL}/instance/qr" \
  -H "apikey: ${INSTANCE_TOKEN}"
```

**Resposta:** `{ "message": "...", "data": { "qrcode": "base64...", "count": 1 } }`

### Verificar Status da Conexão
```bash
curl -X GET "${EVOLUTION_URL}/instance/status" \
  -H "apikey: ${INSTANCE_TOKEN}"
```

**Resposta:** `{ "message": "...", "data": { "Connected": true, "LoggedIn": true, "Name": "..." } }`

### Verificar Usuário no WhatsApp
```bash
curl -X POST "${EVOLUTION_URL}/user/check" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": [
      "5511999999999"
    ]
  }'
```

**Nota:** Verifica se o número está registrado no WhatsApp. Aceita array de números.

### Desconectar Instância (Logout)
```bash
curl -X DELETE "${EVOLUTION_URL}/instance/logout" \
  -H "apikey: ${INSTANCE_TOKEN}"
```

---

## 3. ENVIO DE MENSAGENS (Instance Token)

### Enviar Texto
```bash
curl -X POST "${EVOLUTION_URL}/send/text" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "text": "Olá! Esta é uma mensagem de teste.",
    "delay": 1000
  }'
```

### Enviar Texto com Link Preview
```bash
curl -X POST "${EVOLUTION_URL}/send/link" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "text": "Confira este link: https://exemplo.com",
    "delay": 1000
  }'
```

### Enviar Mídia (Imagem/Vídeo/Áudio/Documento)
```bash
# Enviar por URL
curl -X POST "${EVOLUTION_URL}/send/media" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "url": "https://exemplo.com/imagem.jpg",
    "type": "image",
    "caption": "Legenda da imagem",
    "filename": "imagem.jpg",
    "delay": 1000
  }'

# Enviar por Base64
curl -X POST "${EVOLUTION_URL}/send/media" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "url": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "type": "image",
    "caption": "Imagem base64",
    "delay": 1000
  }'
```

**Types:** `image`, `video`, `audio`, `document`

### Enviar Botões
```bash
curl -X POST "${EVOLUTION_URL}/send/button" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "title": "Título da Mensagem",
    "description": "Texto principal da mensagem",
    "footer": "Rodapé opcional",
    "buttons": [
      { "type": "reply", "displayText": "Opção 1", "id": "btn_1" },
      { "type": "reply", "displayText": "Opção 2", "id": "btn_2" },
      { "type": "url", "displayText": "Visitar Site", "url": "https://exemplo.com" },
      { "type": "call", "displayText": "Ligar Agora", "phoneNumber": "5511999999999" },
      { "type": "copy", "displayText": "Copiar Código", "copyCode": "CODIGO123" }
    ],
    "delay": 1000
  }'
```

**Tipos de Botões:**
- `reply` - Botão de resposta rápida
- `url` - Abre URL
- `call` - Liga para número
- `copy` - Copia texto
- `pix` - Chave PIX

### Enviar Lista
```bash
curl -X POST "${EVOLUTION_URL}/send/list" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "number": "5511999999999",
    "title": "Título da Lista",
    "description": "Descrição da lista de opções",
    "buttonText": "Ver Opções",
    "footerText": "Rodapé da lista",
    "sections": [
      {
        "title": "Seção 1",
        "rows": [
          { "title": "Opção 1", "description": "Descrição da opção 1", "rowId": "opt_1" },
          { "title": "Opção 2", "description": "Descrição da opção 2", "rowId": "opt_2" }
        ]
      },
      {
        "title": "Seção 2",
        "rows": [
          { "title": "Opção 3", "description": "Descrição da opção 3", "rowId": "opt_3" }
        ]
      }
    ],
    "delay": 1000
  }'
```

---

## 4. DOWNLOAD DE MÍDIA (Instance Token)

### Baixar Mídia Recebida
```bash
curl -X POST "${EVOLUTION_URL}/message/downloadmedia" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "message": {
      "imageMessage": {
        "URL": "https://media.whatsapp.net/...",
        "directPath": "/v/t62.7161-24/...",
        "mediaKey": "...",
        "mimetype": "image/jpeg"
      }
    }
  }'
```

**Nota:** O objeto `message` é o payload bruto do webhook da Evolution API.

---

## 5. LABELS (Instance Token)

### Listar Labels
```bash
curl -X GET "${EVOLUTION_URL}/label/list" \
  -H "apikey: ${INSTANCE_TOKEN}"
```

### Criar/Editar Label
```bash
# Criar nova label
curl -X POST "${EVOLUTION_URL}/label/edit" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "name": "Lead Quente",
    "color": 0
  }'

# Editar label existente
curl -X POST "${EVOLUTION_URL}/label/edit" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "labelId": "8",
    "name": "Lead Frio",
    "color": 3
  }'

# Deletar label
curl -X POST "${EVOLUTION_URL}/label/edit" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "labelId": "8",
    "name": "Lead Frio",
    "color": 3,
    "deleted": true
  }'
```

**Cores (0-7):** 0=Azul, 1=Vermelho, 2=Laranja, 3=Verde, 4=Roxo, 5=Cinza, 6=Azul Claro, 7=Rosa

### Aplicar Label em Chat
```bash
curl -X POST "${EVOLUTION_URL}/label/chat" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "jid": "5511999999999@s.whatsapp.net",
    "labelId": "8"
  }'
```

### Remover Label de Chat
```bash
curl -X POST "${EVOLUTION_URL}/unlabel/chat" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "jid": "5511999999999@s.whatsapp.net",
    "labelId": "8"
  }'
```

### Aplicar Label em Mensagem
```bash
curl -X POST "${EVOLUTION_URL}/label/message" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "jid": "5511999999999@s.whatsapp.net",
    "messageId": "true_5511999999999_1234567890_123",
    "labelId": "8"
  }'
```

### Remover Label de Mensagem
```bash
curl -X POST "${EVOLUTION_URL}/unlabel/message" \
  -H "Content-Type: application/json" \
  -H "apikey: ${INSTANCE_TOKEN}" \
  -d '{
    "jid": "5511999999999@s.whatsapp.net",
    "messageId": "true_5511999999999_1234567890_123",
    "labelId": "8"
  }'
```

---

## 6. WEBHOOK - Estrutura do Payload Recebido

A Evolution API envia payloads para sua URL de webhook com a seguinte estrutura:

### Mensagem Recebida (Inbound)
```json
{
  "event": "messages.upsert",
  "instance": "nome-da-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "true_5511999999999_1234567890_123"
    },
    "pushName": "Nome do Remetente",
    "message": {
      "conversation": "Texto da mensagem"
    },
    "messageTimestamp": 1234567890,
    "status": "DELIVERED"
  }
}
```

### Mensagem Enviada (Outbound)
```json
{
  "event": "messages.update",
  "instance": "nome-da-instancia",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": true,
      "id": "true_5511999999999_1234567890_456"
    },
    "status": "READ"
  }
}
```

### QR Code
```json
{
  "event": "qrcode.updated",
  "instance": "nome-da-instancia",
  "data": {
    "qrcode": "base64...",
    "count": 1
  }
}
```

### Conexão
```json
{
  "event": "connection.update",
  "instance": "nome-da-instancia",
  "data": {
    "state": "open",
    "statusReason": 200
  }
}
```

---

## 7. EXEMPLO COMPLETO - CRUD DE INSTÂNCIA

### Passo 1: Criar Instância
```bash
# Cria a instância e obtém o instance_id
CREATE_RESPONSE=$(curl -s -X POST "${EVOLUTION_URL}/instance/create" \
  -H "Content-Type: application/json" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}" \
  -d '{
    "name": "minha-instancia",
    "token": "meu-token-unico",
    "webhook": "https://meusistema.com/webhook"
  }')

echo "$CREATE_RESPONSE"

# Extrair instance_id
INSTANCE_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.instanceId')
```

### Passo 2: Obter QR Code
```bash
# Usa o token da instância (não o admin key)
QR_RESPONSE=$(curl -s -X GET "${EVOLUTION_URL}/instance/qr" \
  -H "apikey: ${INSTANCE_TOKEN}")

echo "$QR_RESPONSE"
# O QR está em .data.qrcode (base64)
```

### Passo 3: Verificar Status
```bash
STATUS=$(curl -s -X GET "${EVOLUTION_URL}/instance/status" \
  -H "apikey: ${INSTANCE_TOKEN}")

echo "$STATUS"
# .data.Connected = true quando conectado
```

### Passo 4: Listar Instâncias
```bash
curl -s -X GET "${EVOLUTION_URL}/instance/all" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}" | jq .
```

### Passo 5: Deletar Instância
```bash
curl -X DELETE "${EVOLUTION_URL}/instance/delete/${INSTANCE_ID}" \
  -H "apikey: ${EVOLUTION_ADMIN_KEY}"
```

---

## 8. NOTAS IMPORTANTES

### Autenticação
- **Admin Key** (`EVOLUTION_API_KEY`): Usada para criar, listar e deletar instâncias
- **Instance Token**: Usado para operações em uma instância específica (mensagens, QR, status, labels)

### Formato do Número
- Sem espaços ou caracteres especiais
- Com código do país
- Exemplo Brasil: `5511999999999`
- Groups: `5511999999999@g.us`

### Webhook URL
- Deve ser HTTPS público
- A Evolution API envia payloads POST para essa URL
- Inclua `?instance=NOME` para identificar a instância

### Retries e Timeouts
- Recomenda-se timeout de 120 segundos
- A API pode demorar para gerar QR codes
- Mensagens podem ter delay configurável (campo `delay` em ms)

### JID Format
- Pessoas: `5511999999999@s.whatsapp.net`
- Grupos: `5511999999999@g.us`
- Broadcasts: `5511999999999@broadcast`
