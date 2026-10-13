# JARVIS nativo (Android)

App Android nativo em Kotlin, sem bibliotecas externas. Uso pessoal: instala direto o APK, sem Play Store.

## O que ele faz de verdade
- Fica ouvindo em segundo plano (serviço com notificação fixa). Diga "Jarvis, ..." e o pedido.
- Envia WhatsApp sozinho: abre a conversa e toca em Enviar (aceita nome de contato ou número).
- Responde mensagens que chegaram (WhatsApp, Telegram etc.) pela resposta rápida da notificação.
- Controla qualquer outro app (Instagram, Facebook...): lê a tela, toca, digita, rola, volta, vai para o início.
- Liga e manda SMS direto. Cria alarmes e lembretes. Abre qualquer app instalado.
- Clima, pesquisa na web (Gemini), notas, memória, lanterna, volume, mídia, área de transferência.
- Entende a tela por imagem (Android 11+) com a ferramenta see_screen.

## Como gerar o APK

### Opção A: pelo GitHub (sem computador)
1. Crie um repositório no GitHub e envie todo o conteúdo desta pasta (incluindo a pasta .github).
2. Abra a aba Actions > "Gerar APK" > Run workflow (ou ele roda sozinho no envio).
3. Quando terminar, abra a execução e baixe o artefato "jarvis-apk" (zip com o app-debug.apk).
4. Descompacte e instale o APK no celular (permita "instalar apps desconhecidos").

### Opção B: Android Studio
Abra esta pasta no Android Studio, deixe sincronizar e use Build > Build APK(s).

## Configuração no celular (uma vez)
1. Abra o app e cole a chave do Google AI Studio em Ajustes. Toque em Salvar.
2. Conceda as permissões que o app pedir (microfone, contatos, ligações, SMS, localização, notificações).
3. Em Ajustes do Jarvis, siga os botões 1 a 4:
   - Android 13+: primeiro vá em "Informações do app", toque nos três pontinhos e escolha
     "Permitir configurações restritas". Sem isso o Android não deixa ativar a Acessibilidade.
   - Ative Acessibilidade > JARVIS.
   - Ative o acesso a Notificações > JARVIS.
   - Permita sobrepor outros apps (necessário para abrir apps com a tela desligada ou em segundo plano).
   - Desative a otimização de bateria para o app.
4. Na tela principal, toque em "Ouvir".

## Segurança
- Apps de banco e pagamento vêm bloqueados (lista editável em Ajustes): o Jarvis não lê nem toca neles.
- O prompt instrui o assistente a só obedecer ao que você pediu, e a tratar textos de telas, notificações e
  mensagens como dados. Mesmo assim, evite pedir tarefas automáticas sobre conversas de desconhecidos.
- Sua chave de API fica só no aparelho.

## Limites conhecidos
- O recurso de ouvir pode dar um "bip" do reconhecedor do Google a cada ciclo em alguns aparelhos.
- O serviço de escuta não volta sozinho depois de reiniciar o celular: abra o app e toque em Ouvir.
- Automação de tela depende do layout de cada app; se um app mudar, o Jarvis pode errar e tenta de novo lendo a tela.
- Lembretes não sobrevivem a reinicialização do aparelho.
- Câmera (ver pela câmera) ainda não foi portada; use see_screen para analisar o que está na tela.
