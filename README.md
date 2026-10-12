# JARVIS Neural Core — PWA

Interface holográfica avançada do JARVIS, pronta para ser transformada em aplicativo Android via **PWABuilder**.

## Conteúdo do pacote

```
jarvis-pwa/
├── index.html          ← App principal (Neural Core + Chat)
├── manifest.json       ← Manifesto PWA completo
├── sw.js               ← Service Worker (funciona offline)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
└── README.md
```

---

## Como publicar no GitHub Pages

1. Crie um novo repositório no GitHub (ex: `jarvis-neural-core`)
2. Faça o upload de **todos os arquivos** desta pasta para a **raiz** do repositório
3. Vá em **Settings → Pages**
4. Em **Source**, escolha:
   - Branch: `main` (ou `master`)
   - Folder: `/ (root)`
5. Clique em **Save**
6. Aguarde 1–2 minutos e copie o link gerado, algo como:
   ```
   https://SEU-USUARIO.github.io/jarvis-neural-core/
   ```

---

## Como gerar o APK com PWABuilder

1. Acesse: [https://www.pwabuilder.com](https://www.pwabuilder.com)
2. Cole o link da sua GitHub Pages
3. Clique em **Start**
4. Aguarde a análise (ele vai detectar o `manifest.json` e o service worker)
5. Vá na aba **Android**
6. Clique em **Generate Package** → escolha **Android**
7. Baixe o arquivo `.zip` gerado
8. Dentro dele terá o **APK** (ou o projeto Android Studio)

### Opções recomendadas no PWABuilder:
- **Package ID**: `com.seuusuario.jarvis`
- **App name**: `JARVIS`
- **Theme color**: `#6366f1`
- **Background color**: `#07090f`
- Marque a opção de **standalone**

---

## Modo de funcionamento

| Modo | Descrição |
|------|---------|
| **Local (Demo)** | Funciona 100% offline. O núcleo neural anima, o chat responde com frases de demonstração. |
| **Com Backend** | Nas configurações (ícone ⚙) você pode colocar a URL do servidor JARVIS. Assim o app tenta enviar comandos reais. |

---

## Observações importantes

- Este PWA é **estático**. Ele não precisa de servidor Python para rodar a interface.
- Para ter voz real + comandos do JARVIS desktop, o backend precisa estar acessível pela internet (ou na mesma rede).
- O manifesto e o service worker estão completos e prontos para o PWABuilder gerar o APK sem erros.

---

Feito para funcionar direto no fluxo:  
**GitHub → Pages → PWABuilder → APK Android**
# Jarvis
