# N.E.X.U.S. — como colocar no ar

Sua IA pessoal roda num servidor grátis da Oracle e você usa pelo celular como um app. Leva uns 40 minutos, quase tudo esperando o instalador.

## O que tem aqui

| Pasta / arquivo | O que é |
| --- | --- |
| `server/` | API em Node.js (sem dependências): conversa, memória, roteador de IAs, ferramentas, build do APK |
| `web/` | O app (PWA) com o visual novo: conversa limpa, menu lateral, janelas das ferramentas |
| `install.sh` | Instala tudo no servidor com um comando |
| `scripts/workflow-build-apk.yml` | Workflow que o Nexus coloca no seu GitHub para gerar APK na nuvem |
| `test/mock-llm.js` | IA de mentira, só para testar sem o modelo |

## 1. Criar o servidor na Oracle

1. Entre em cloud.oracle.com → **Compute → Instances → Create instance**.
2. **Image:** Ubuntu 24.04 (ou 22.04). **Shape:** Ampere `VM.Standard.A1.Flex` com **4 OCPU e 24 GB** (é o máximo grátis).
3. Em **Add SSH keys**, baixe a chave privada (`.key`). Guarde bem.
4. Crie e anote o **IP público**.

## 2. Liberar as portas 80 e 443

Na instância: **Subnet → Security List → Add Ingress Rules**. Crie duas regras com origem `0.0.0.0/0`, protocolo TCP, portas `80` e `443`. (O firewall interno do Ubuntu o instalador já libera.)

## 3. Pegar o endereço grátis

Entre em duckdns.org, crie um subdomínio (ex.: `meunexus`) e copie o **token** do topo da página.

## 4. Enviar e instalar (pelo Termux)

```bash
# no celular, na pasta onde está o nexus.zip e a chave
chmod 600 chave.key
scp -i chave.key nexus.zip ubuntu@SEU_IP:~
ssh -i chave.key ubuntu@SEU_IP

# já dentro do servidor
sudo apt-get install -y unzip && unzip nexus.zip && cd nexus
bash install.sh
```

O instalador pergunta o subdomínio e o token do DuckDNS e faz o resto sozinho. Na primeira vez, a IA local baixa o modelo (~2,5 GB). Para acompanhar, rode `bash install.sh logs` (saia com Ctrl+C).

## 5. Primeiro acesso

1. Abra `https://meunexus.duckdns.org` no Chrome do celular.
2. Crie a sua senha.
3. No menu do Chrome, toque em **Adicionar à tela inicial**. Vira um app.
4. Permita o microfone. Com o app aberto, diga “Nexus, …” de qualquer tela.

## 6. IAs de reforço (opcional, recomendado)

Em **Configurações → IAs de reforço**, cole as chaves grátis. Cada uma tem o link “pegar chave”: Groq, Gemini (Google AI Studio), OpenRouter e Mistral. Código e pedidos difíceis vão para elas; quando uma bate o limite, passa para a próxima; sem nenhuma, a IA local responde. A sua memória nunca é enviada para fora.

## 7. Build do APK

Em **Configurações → Build do APK** você escolhe:

- **No servidor:** já fica instalado (Android SDK + aapt2 ARM64). Serve para **sites e jogos** (viram app com o Capacitor).
- **GitHub Actions:** necessário para **apps Expo/React Native**. O Google não publica o NDK para servidores ARM, então esses apps compilam no GitHub. Se o GitHub estiver configurado, o Nexus troca sozinho.

Para o GitHub:

1. Crie um repositório (pode ser privado), ex.: `nexus-builds`.
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate. Escolha só esse repositório. Em permissões, deixe **Contents**, **Actions** e **Pages** em *Read and write*.
3. No app, cole o link do repositório e o token. Toque em **Testar conexão**.

O token fica criptografado no servidor. Os APKs saem assinados com a chave `dados/nexus.keystore`. **Faça backup dela**: sem ela, você não consegue atualizar um app já instalado.

## Comandos úteis no servidor

| Comando | Para quê |
| --- | --- |
| `bash install.sh status` | Ver se está tudo rodando |
| `bash install.sh logs` | Registros ao vivo |
| `bash install.sh update` | Depois de enviar uma versão nova da pasta |
| `bash install.sh android` | Reinstalar o build Android |
| `bash install.sh whisper` | Ouvir pelo servidor (para navegadores sem reconhecimento de voz) |
| `sudo systemctl restart nexus` | Reiniciar só o app |

## Backup

Copie a pasta `~/nexus/dados` e o arquivo `~/nexus/.env`. Ali estão as conversas, a memória, as chaves e a keystore.

## Se algo der errado

- **“IA local fora do ar” na tela Sistema:** o modelo ainda está baixando ou a memória acabou. Veja `bash install.sh logs`.
- **O site não abre:** confira as portas 80/443 na Security List (passo 2) e se o DuckDNS aponta para o IP certo.
- **Microfone bloqueado:** Chrome → cadeado ao lado do endereço → Permissões → Microfone → Permitir.
- **Build no servidor falhou:** veja o log na janela Build. Para apps Expo, use o GitHub Actions.

## Testar no computador (sem o modelo)

```bash
node test/mock-llm.js 18080 &
LLM_URL=http://127.0.0.1:18080/v1 EMBED_URL=http://127.0.0.1:18080/v1 NEXUS_DATA=/tmp/nexus NEXUS_PROJECTS=/tmp/projetos npm start
# abra http://127.0.0.1:3000
```
