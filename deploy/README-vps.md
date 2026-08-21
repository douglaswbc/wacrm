# Deploy do wacrm na VPS — Portainer + Traefik

Guia completo para subir o wacrm em VPS com Docker Swarm gerenciado pelo
Portainer, Traefik como proxy reverso (rede externa `DwbCNet`) e TLS via
Let's Encrypt.

Domínio usado nos exemplos: **`app.autofunil.com.br`** — substitua se usar outro.

---

## 0. Pré-requisitos

- VPS com Docker Swarm ativo e Traefik já rodando (rede `DwbCNet` externa)
- Portador com acesso ao Portainer (Stacks)
- DNS: registro `A` de `app.autofunil.com.br` apontando para o IP da VPS
- Projeto Supabase com o `supabase/schema.sql` já aplicado (SQL Editor)

---

## 1. Build da imagem (na VPS, via SSH)

> ⚠️ **As variáveis `NEXT_PUBLIC_*` são embutidas no bundle no build.**
> Sem os build args abaixo, o app sobe mas o login falha no navegador.

```bash
git clone https://github.com/douglaswbc/wacrm && cd wacrm

docker build -t wacrm:latest \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...sua-anon-key \
  --build-arg NEXT_PUBLIC_SITE_URL=https://app.autofunil.com.br \
  .
```

O build leva vários minutos (compilação Next.js/Turbopack). Se a VPS tiver
pouca RAM, o Dockerfile já usa `--max-old-space-size=4096` no estágio de build.

---

## 2. Deploy da stack no Portainer

1. **Portainer → Stacks → + Add stack**
2. Nome: `wacrm`
3. **Build method**: *Web editor*
4. Cole o conteúdo de [`example.wacrm.yaml`](../example.wacrm.yaml) editando:

| Variável | Onde obter / gerar |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API (**secreta** — bypassa RLS) |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` ⚠️ se já houver tokens salvos no Supabase, use **a mesma** chave da época |
| `AUTOMATION_CRON_SECRET` | `openssl rand -hex 32` (guarde — será usado no cron) |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | Do seu servidor Evolution Go existente |
| `GOOGLE_CALENDAR_*` | Google Cloud Console → OAuth2 Client (redirect URI: `https://app.autofunil.com.br/api/calendar/callback`) |
| `RYZEAPI_API_URL` / `RYZEAPI_ADMIN_TOKEN` | Do seu servidor RyzeAPI |
| `ZERNIO_API_KEY` / `ZERNIO_WEBHOOK_SECRET` | zernio.com/dashboard → API Keys |

5. **Deploy the stack**

O Traefik emitirá o certificado automaticamente. Em ~1 minuto,
`https://app.autofunil.com.br` deve exibir a tela de login.

Verifique a saúde do container: Portainer → Containers → `wacrm` deve estar
`(healthy)` após ~60s.

---

## 3. Cron dos engines (obrigatório para automations/flows)

Os endpoints de cron precisam ser pingados a cada minuto com o header
`x-cron-secret`.

### 3.1 Instalar o cron (distros mínimas vêm sem ele)

Em Debian/Ubuntu enxuto, o `crontab` pode não existir:

```bash
apt-get update && apt-get install -y cron
systemctl enable --now cron
```

### 3.2 Registrar os agendamentos

⚠️ **Colar linhas de cron direto no terminal NÃO registra nada** — elas são
executadas uma vez pelo bash e descartadas. Use um dos métodos abaixo.

**Método não-interativo (recomendado)** — cole o bloco inteiro no terminal,
substituindo o secret pelo valor de `AUTOMATION_CRON_SECRET`:

```bash
cat <<'EOF' | crontab -
* * * * * curl -s -H "x-cron-secret: SEU_AUTOMATION_CRON_SECRET" https://app.autofunil.com.br/api/automations/cron > /dev/null 2>&1
* * * * * curl -s -H "x-cron-secret: SEU_AUTOMATION_CRON_SECRET" https://app.autofunil.com.br/api/flows/cron > /dev/null 2>&1
* * * * * curl -s -H "x-cron-secret: SEU_AUTOMATION_CRON_SECRET" https://app.autofunil.com.br/api/instagram/cron > /dev/null 2>&1
EOF
```

**Método interativo:** `crontab -e` (escolha nano se perguntar), cole as 3
linhas no final e salve com Ctrl+O → Enter → Ctrl+X.

> Se o root já tiver outros agendamentos, prefira o método interativo —
> o bloco acima **substitui** todo o crontab existente.

### 3.3 Verificar

```bash
crontab -l                          # deve listar as 3 linhas
systemctl status cron --no-pager    # deve estar active (running)

# teste manual — deve retornar JSON, não erro:
curl -H "x-cron-secret: SEU_AUTOMATION_CRON_SECRET" https://app.autofunil.com.br/api/automations/cron
```

Respostas possíveis do teste manual:

| Resposta | Significado |
|---|---|
| JSON com contadores (`fired`, `processed`, etc.) | ✅ Funcionando |
| `{"error":"Unauthorized"}` | O secret do header difere do da stack |
| `{"error":"cron not configured"}` | `AUTOMATION_CRON_SECRET` não chegou no container — confira a env na stack do Portainer e faça redeploy |

Sem o cron configurado, automations com agendamento (`time_based`) e flows
com wait steps **não disparam**.

Alternativa: [cron-job.org](https://cron-job.org) com header customizado
`x-cron-secret`.

---

## 4. Conectar o WhatsApp (Evolution Go)

1. Login no wacrm → **Settings → Evolution API**
2. Informe o nome da instância e clique em criar/conectar
3. Escaneie o QR Code com o WhatsApp
4. Ao conectar, o webhook é registrado automaticamente em:
   `https://app.autofunil.com.br/api/evolution/webhook`

Se o webhook não registrar, verifique no painel da Evolution Go se a URL
acima está configurada para os eventos de mensagem.

---

## 5. Smoke tests (ponta a ponta)

1. ✅ Login com usuário admin
2. ✅ Inbox carrega conversas (realtime ativo)
3. ✅ Enviar **texto**, **mídia** (imagem/documento), **botões** (reply e tipos copy/url/call/pix) e **lista**
4. ✅ Aplicar/remover **label** numa conversa e ver refletir no WhatsApp
5. ✅ Receber mensagem inbound (responder do celular) — mídia inbound aparece na inbox
6. ✅ Responder clicando num botão reply → automation/flow reage
7. ✅ Settings → AI Assistant: salvar chave OpenAI/Anthropic (criptografada com ENCRYPTION_KEY)

---

## Troubleshooting

| Sintoma | Causa provável | Correção |
|---|---|---|
| Tela de login branca / erro `supabaseUrl is required` no console | Imagem construída sem build args `NEXT_PUBLIC_*` | Refazer o passo 1 e reiniciar a stack |
| Container `(healthy: starting)` por muito tempo | Primeiro boot compilando caches | Aguardar `start_period` (60s); verificar logs |
| Certificado TLS não emite | DNS ainda não propagou ou porta 80 bloqueada | `dig app.autofunil.com.br`; liberar 80/443 |
| Webhook Evolution não recebe mensagens | URL errada no painel da Evolution | Conferir `https://app.autofunil.com.br/api/evolution/webhook` |
| Automations time_based não disparam | Cron não configurado ou distro sem o pacote | Seção 3 (instalar `cron` + registrar agendamentos) |
| `crontab: command not found` | Debian/Ubuntu mínimo sem o pacote cron | `apt-get install -y cron && systemctl enable --now cron` |
| Erro de descriptografia ao salvar config WhatsApp | `ENCRYPTION_KEY` diferente da usada antes | Usar a mesma chave; tokens antigos precisam ser re-salvos |
