#!/usr/bin/env bash
# N.E.X.U.S. — instalador para o Oracle Cloud Always Free (Ubuntu 22.04/24.04, ARM Ampere A1)
#
#   bash install.sh            instala tudo (IA, app, voz, build Android, HTTPS)
#   bash install.sh android    só o build Android no servidor
#   bash install.sh whisper    reconhecimento de voz no servidor (opcional)
#   bash install.sh https      só o domínio DuckDNS + HTTPS
#   bash install.sh update     atualiza o app depois de enviar a pasta nova
#   bash install.sh status     mostra se os serviços estão rodando
#   bash install.sh logs       mostra os registros ao vivo
set -euo pipefail

APP_DIR="$HOME/nexus"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LLAMA_DIR="$HOME/llama.cpp"
ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
CMDLINE_TOOLS_BUILD="14742923"
NODE_MAJOR=22
QWEN="${QWEN_MODEL:-Qwen/Qwen3-4B-GGUF:Q4_K_M}"
EMBED="${EMBED_MODEL:-ggml-org/embeddinggemma-300M-GGUF}"
PIPER_URL="https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz"
VOICE_BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/pt/pt_BR/faber/medium"

c_ok=$'\e[32m'; c_w=$'\e[33m'; c_e=$'\e[31m'; c_b=$'\e[1m'; c_0=$'\e[0m'
step() { echo; echo "${c_b}▶ $*${c_0}"; }
ok()   { echo "${c_ok}✔ $*${c_0}"; }
warn() { echo "${c_w}! $*${c_0}"; }
die()  { echo "${c_e}✖ $*${c_0}"; exit 1; }

[ "$(id -u)" -eq 0 ] && die "Rode como o usuário normal (ubuntu), não como root. O script usa sudo quando precisa."
command -v sudo >/dev/null || die "sudo não encontrado."
ARCH="$(uname -m)"
[ "$ARCH" = "aarch64" ] || warn "Este servidor é $ARCH. O script foi feito para ARM (aarch64); a maior parte funciona, mas a voz e o build Android podem precisar de ajuste."
NPROC="$(nproc)"; THREADS=$(( NPROC > 1 ? NPROC - 1 : 1 ))

env_get() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- || true; }
env_set() { touch "$APP_DIR/.env"; if grep -qE "^$1=" "$APP_DIR/.env"; then sed -i "s|^$1=.*|$1=$2|" "$APP_DIR/.env"; else echo "$1=$2" >> "$APP_DIR/.env"; fi; }

# ---------------------------------------------------------------- base
base() {
  step "Pacotes do sistema"
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential cmake git curl wget unzip zip ffmpeg ca-certificates gnupg \
    libcurl4-openssl-dev python3 jq file netfilter-persistent iptables-persistent openjdk-17-jdk-headless
  ok "Pacotes instalados"

  if ! swapon --show | grep -q .; then
    step "Criando 4 GB de swap (ajuda a compilar sem travar)"
    sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
    grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
    ok "Swap ligada"
  fi

  if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]; then
    step "Node.js $NODE_MAJOR"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | sudo -E bash -
    sudo apt-get install -y nodejs
  fi
  ok "Node $(node -v)"
}

# ---------------------------------------------------------------- app
app() {
  step "Copiando o app para $APP_DIR"
  mkdir -p "$APP_DIR"
  if [ "$SRC_DIR" != "$APP_DIR" ]; then
    tar -C "$SRC_DIR" --exclude=./dados --exclude=./.env --exclude=./voz -cf - . | tar -C "$APP_DIR" -xf -
  fi
  mkdir -p "$APP_DIR/dados" "$HOME/projetos"
  if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    env_set NEXUS_SECRET "$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
    env_set NEXUS_PROJECTS "$HOME/projetos"
    env_set ANDROID_HOME "$ANDROID_HOME"
    env_set JAVA17_HOME "/usr/lib/jvm/java-17-openjdk-arm64"
    env_set JAVA21_HOME "/usr/lib/jvm/java-21-openjdk-arm64"
    chmod 600 "$APP_DIR/.env"
  fi
  ok "App no lugar (dados em $APP_DIR/dados, projetos em ~/projetos)"
}

# ---------------------------------------------------------------- IA local
llama() {
  step "Compilando o llama.cpp (leva uns 10 minutos)"
  if [ ! -d "$LLAMA_DIR/.git" ]; then git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_DIR"; else git -C "$LLAMA_DIR" pull --ff-only || true; fi
  cmake -S "$LLAMA_DIR" -B "$LLAMA_DIR/build" -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=ON -DLLAMA_CURL=ON >/dev/null
  cmake --build "$LLAMA_DIR/build" -j "$NPROC" --target llama-server
  ok "llama-server pronto"
}

# ---------------------------------------------------------------- voz (Piper)
voice() {
  step "Voz masculina pt-BR (Piper · faber)"
  mkdir -p "$APP_DIR/voz"
  if [ ! -x "$APP_DIR/voz/piper/piper" ]; then
    curl -fL "$PIPER_URL" -o /tmp/piper.tgz && tar -C "$APP_DIR/voz" -xzf /tmp/piper.tgz && rm -f /tmp/piper.tgz \
      || { warn "Não consegui baixar o Piper. O app usa a voz do celular."; return 0; }
  fi
  for f in pt_BR-faber-medium.onnx pt_BR-faber-medium.onnx.json; do
    [ -f "$APP_DIR/voz/$f" ] || curl -fL "$VOICE_BASE/$f" -o "$APP_DIR/voz/$f" || warn "Falha ao baixar $f"
  done
  if echo "Teste de voz do Nexus." | "$APP_DIR/voz/piper/piper" --model "$APP_DIR/voz/pt_BR-faber-medium.onnx" --output_file /tmp/nexus-teste.wav >/dev/null 2>&1; then
    rm -f /tmp/nexus-teste.wav; ok "Voz funcionando"
  else warn "O Piper não rodou neste servidor; o app vai usar a voz do celular."; fi
}

# ---------------------------------------------------------------- Whisper (opcional)
whisper() {
  step "Whisper (ouvir pelo servidor, opcional)"
  local W="$APP_DIR/voz/whisper.cpp"
  [ -d "$W/.git" ] || git clone --depth 1 https://github.com/ggml-org/whisper.cpp "$W"
  cmake -S "$W" -B "$W/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
  cmake --build "$W/build" -j "$NPROC" --target whisper-cli
  [ -f "$W/models/ggml-base.bin" ] || bash "$W/models/download-ggml-model.sh" base
  ok "Whisper pronto"
  sudo systemctl restart nexus 2>/dev/null || true
}

# ---------------------------------------------------------------- build Android
android() {
  step "Build Android no servidor (Android SDK + aapt2 ARM64)"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk-headless openjdk-21-jdk-headless
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  if [ ! -x "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
    curl -fL "https://dl.google.com/android/repository/commandlinetools-linux-${CMDLINE_TOOLS_BUILD}_latest.zip" -o /tmp/cmdline.zip
    rm -rf /tmp/cmdline && unzip -q /tmp/cmdline.zip -d /tmp/cmdline && rm -rf "$ANDROID_HOME/cmdline-tools/latest"
    mv /tmp/cmdline/cmdline-tools "$ANDROID_HOME/cmdline-tools/latest" && rm -rf /tmp/cmdline /tmp/cmdline.zip
  fi
  export ANDROID_HOME JAVA_HOME=/usr/lib/jvm/java-17-openjdk-arm64
  local SDKM="$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager"
  yes | "$SDKM" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
  "$SDKM" --sdk_root="$ANDROID_HOME" "platforms;android-35" "build-tools;35.0.0" >/dev/null
  ok "Android SDK (plataforma 35, apksigner)"

  # o aapt2 do Google é só x86: entra a versão ARM64 compilada do código oficial
  if [ ! -x "$ANDROID_HOME/build-tools/35.0.2/aapt2" ]; then
    rm -rf /tmp/sdk-arm64 && git clone --depth 1 https://github.com/hamza72x/android-sdk-linux-arm64.git /tmp/sdk-arm64
    (cd /tmp/sdk-arm64 && ANDROID_HOME="$ANDROID_HOME" ./setup.sh install-build-tools 35.0.2) || warn "Não consegui instalar o aapt2 ARM64."
  fi
  local AAPT2="$ANDROID_HOME/build-tools/35.0.2/aapt2"
  if [ -x "$AAPT2" ] && file "$AAPT2" | grep -qi 'aarch64'; then
    env_set AAPT2_ARM64 "$AAPT2"; ok "aapt2 ARM64 pronto"
  else
    warn "aapt2 ARM64 não ficou disponível: o build no servidor não vai funcionar. Use o GitHub Actions."
  fi

  # chave que assina todos os seus APKs (guarde o backup!)
  if [ ! -f "$APP_DIR/dados/nexus.keystore" ]; then
    local PASS; PASS="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
    keytool -genkeypair -keystore "$APP_DIR/dados/nexus.keystore" -alias nexus -keyalg RSA -keysize 2048 -validity 10000 \
      -storepass "$PASS" -keypass "$PASS" -dname "CN=Nexus, O=Pessoal, C=BR" >/dev/null 2>&1
    env_set NEXUS_KEYSTORE "$APP_DIR/dados/nexus.keystore"; env_set NEXUS_KEYSTORE_PASS "$PASS"
    chmod 600 "$APP_DIR/dados/nexus.keystore"
    ok "Chave de assinatura criada em dados/nexus.keystore (faça backup!)"
  fi
  sudo systemctl restart nexus 2>/dev/null || true
}

# ---------------------------------------------------------------- serviços
services() {
  step "Serviços (ligam sozinhos quando o servidor reinicia)"
  local NODE; NODE="$(command -v node)"
  sudo tee /etc/systemd/system/nexus-llm.service >/dev/null <<EOF
[Unit]
Description=Nexus · IA local (llama-server, Qwen 3 4B)
After=network-online.target
Wants=network-online.target
[Service]
User=$USER
Environment=HOME=$HOME
ExecStart=$LLAMA_DIR/build/bin/llama-server -hf $QWEN --alias qwen3-4b --host 127.0.0.1 --port 8080 -c 16384 -t $THREADS --jinja --temp 0.6 --top-p 0.95 --top-k 20 --min-p 0
Restart=always
RestartSec=5
Nice=5
[Install]
WantedBy=multi-user.target
EOF
  sudo tee /etc/systemd/system/nexus-embed.service >/dev/null <<EOF
[Unit]
Description=Nexus · memória (embeddings)
After=network-online.target
[Service]
User=$USER
Environment=HOME=$HOME
ExecStart=$LLAMA_DIR/build/bin/llama-server -hf $EMBED --embeddings --host 127.0.0.1 --port 8081 -c 2048 -t 1
Restart=always
RestartSec=5
Nice=10
[Install]
WantedBy=multi-user.target
EOF
  sudo tee /etc/systemd/system/nexus.service >/dev/null <<EOF
[Unit]
Description=Nexus · API e app
After=network-online.target nexus-llm.service
[Service]
User=$USER
WorkingDirectory=$APP_DIR
Environment=HOME=$HOME
Environment=PATH=/usr/local/bin:/usr/bin:/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools
EnvironmentFile=$APP_DIR/.env
ExecStart=$NODE --disable-warning=ExperimentalWarning server/index.js
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now nexus-llm nexus-embed nexus >/dev/null
  ok "Serviços ligados. Na primeira vez o modelo (~2,5 GB) é baixado; veja com: bash install.sh logs"
}

# ---------------------------------------------------------------- HTTPS
https() {
  step "Endereço com HTTPS (DuckDNS + Caddy)"
  local DOM="${DOMINIO:-$(env_get NEXUS_DOMINIO)}" TOK="${DUCKDNS_TOKEN:-$(env_get DUCKDNS_TOKEN)}"
  if [ -z "$DOM" ]; then read -rp "Seu subdomínio do DuckDNS (só o nome, ex.: meunexus): " DOM; fi
  DOM="${DOM%.duckdns.org}"
  if [ -z "$TOK" ]; then read -rp "Token do DuckDNS (está no topo de duckdns.org): " TOK; fi
  [ -n "$DOM" ] && [ -n "$TOK" ] || die "Preciso do subdomínio e do token do DuckDNS."
  env_set NEXUS_DOMINIO "$DOM"; env_set DUCKDNS_TOKEN "$TOK"; env_set NEXUS_PUBLIC_URL "https://$DOM.duckdns.org"
  chmod 600 "$APP_DIR/.env"

  # mantém o DuckDNS apontando para o IP do servidor
  mkdir -p "$APP_DIR/dados"
  cat > "$APP_DIR/dados/duckdns.sh" <<EOF
#!/bin/sh
curl -fsS "https://www.duckdns.org/update?domains=$DOM&token=$TOK&ip=" -o $APP_DIR/dados/duckdns.log
EOF
  chmod 700 "$APP_DIR/dados/duckdns.sh"; "$APP_DIR/dados/duckdns.sh" || true
  ( crontab -l 2>/dev/null | grep -v duckdns.sh; echo "*/5 * * * * $APP_DIR/dados/duckdns.sh >/dev/null 2>&1" ) | crontab -
  grep -q OK "$APP_DIR/dados/duckdns.log" 2>/dev/null && ok "DuckDNS atualizado" || warn "O DuckDNS não respondeu OK; confira o token."

  # portas 80 e 443 no firewall interno do Ubuntu da Oracle
  for p in 80 443; do
    sudo iptables -C INPUT -p tcp --dport $p -m state --state NEW -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport $p -m state --state NEW -j ACCEPT
  done
  sudo netfilter-persistent save >/dev/null 2>&1 || true

  if ! command -v caddy >/dev/null; then
    sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    sudo apt-get update -y && sudo apt-get install -y caddy
  fi
  sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
$DOM.duckdns.org {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
EOF
  sudo systemctl reload caddy || sudo systemctl restart caddy
  sudo systemctl restart nexus 2>/dev/null || true
  ok "Pronto: https://$DOM.duckdns.org"
  warn "Lembre de liberar as portas 80 e 443 na Security List da Oracle (passo 3 do LEIA-ME)."
}

status() {
  for s in nexus-llm nexus-embed nexus caddy; do printf '%-12s %s\n' "$s" "$(systemctl is-active $s 2>/dev/null || true)"; done
  curl -fsS http://127.0.0.1:3000/api/health 2>/dev/null && echo || echo "API não respondeu"
}

case "${1:-tudo}" in
  tudo)    base; app; llama; voice; services; android || warn "Build Android ficou incompleto; rode depois: bash install.sh android"; https
           echo; ok "Tudo instalado. Abra https://$(env_get NEXUS_DOMINIO).duckdns.org no celular, crie sua senha e instale o app pelo menu do Chrome (Adicionar à tela inicial)." ;;
  android) android ;;
  whisper) whisper ;;
  https)   https ;;
  update)  app; sudo systemctl restart nexus; ok "App atualizado" ;;
  status)  status ;;
  logs)    sudo journalctl -f -u nexus -u nexus-llm -u nexus-embed ;;
  *) die "Opção desconhecida: $1" ;;
esac
