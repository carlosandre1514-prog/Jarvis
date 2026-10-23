# Gerador de Ativos 3D com IA

Site que transforma texto em modelos 3D prontos para game engine:
personagens de **corpo inteiro** (A-pose/T-pose), criaturas, objetos, armas, veículos e construções,
**coloridos com texturas PBR** ou **só o modelo em branco**, com download em **.FBX** (Unreal/Unity) e **.GLB** (Godot/Web).

```
Site (GitHub Pages)  ──senha──►  Worker (Cloudflare, guarda as chaves)  ──►  Meshy / Tripo3D
       ▲                                                                         │
       └──────────── visualizador 360° + download .FBX / .GLB ◄──────────────────┘
```

**Por que um Worker?** O GitHub Pages só hospeda arquivos estáticos. Se a chave da API ficasse no site,
qualquer visitante poderia copiá-la e gastar seus créditos. O Worker (grátis) guarda as chaves e só
atende quem souber a sua senha.

## Recursos

- Tipos: Personagem (corpo inteiro), Criatura, Objeto, Arma/Item, Veículo, Construção
- Acabamento: **Colorido (PBR: cor, normal, rugosidade, metal)** ou **Só o modelo (branco)**
- Campo de cores e materiais, estilo (realista, estilizado, cartoon, low poly), pose A/T para rig
- Controle de polígonos (Mobile 5k / PC 30k / Alta 100k) e topologia quads ou triângulos
- Visualizador 360° com modos **Textura / Argila / Malha (wireframe)**, grade e estatísticas
- Downloads .FBX, .GLB e .OBJ · histórico dos modelos gerados · abre .GLB/.FBX do computador
- Funciona no celular

## Como colocar no ar (uma vez só, ~15 minutos)

### 1. Chaves das IAs (pelo menos uma)
- **Meshy**: https://www.meshy.ai/api → crie uma API key (precisa de plano com créditos de API)
- **Tripo3D**: https://platform.tripo3d.ai → API Keys

### 2. Criar o Worker no Cloudflare (grátis)
1. Crie uma conta em https://dash.cloudflare.com
2. Menu **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** (modelo "Hello World")
   → dê o nome `gerador-3d-proxy` → **Deploy**
3. Clique em **Edit code**, apague tudo, cole o conteúdo de [`worker/worker.js`](worker/worker.js) e clique em **Deploy**
4. Volte ao Worker → **Settings** → **Variables and Secrets** → **Add**:

   | Nome | Tipo | Valor |
   |---|---|---|
   | `ACCESS_TOKEN` | Secret | uma senha forte inventada por você |
   | `MESHY_API_KEY` | Secret | sua chave da Meshy |
   | `TRIPO_API_KEY` | Secret | sua chave da Tripo3D (se tiver) |
   | `ALLOWED_ORIGIN` | Text | `https://SEU-USUARIO.github.io` |

5. Copie o endereço do Worker (algo como `https://gerador-3d-proxy.SEU-NOME.workers.dev`)

### 3. Ativar o GitHub Pages
1. No repositório: **Settings** → **Pages** → em **Source** escolha **GitHub Actions**
2. Garanta que este código está no branch `main` (o workflow publica a cada push no `main`)
3. Aba **Actions** → "Publicar no GitHub Pages" → espere ficar verde
4. O site fica em `https://SEU-USUARIO.github.io/NOME-DO-REPO/`

### 4. Primeiro acesso
Abra o site → cole o endereço do Worker e a senha (`ACCESS_TOKEN`) → **Salvar e testar**.
Fica salvo no navegador. Em outro aparelho, é só digitar de novo.

> Opcional: em **Settings → Secrets and variables → Actions → Variables** crie `WORKER_URL`
> com o endereço do Worker; aí o site já vem com ele preenchido e só a senha é pedida.

## Dicas para resultados profissionais

- Descreva **idade, tipo de corpo, roupas, acessórios e proporções**. Inglês costuma funcionar melhor.
- Para personagens que vão ser animados, use **A-pose** + **Quads**.
- "Só o modelo (branco)" é mais rápido e mais barato: ótimo para testar formas antes de gerar com cor.
- Use o modo **Malha** do visualizador para conferir a topologia antes de baixar.
- Os links dos arquivos gerados pelas IAs expiram depois de alguns dias: baixe o que quiser guardar.

## Estrutura

| Pasta | O que é |
|---|---|
| `web/` | Site Next.js (exportação estática) + Tailwind + React Three Fiber |
| `web/lib/prompt.ts` | Monta o prompt técnico (corpo inteiro, pose, estilo, branco/colorido) |
| `web/lib/providers.ts` | Fluxos da Meshy (preview → refine PBR) e da Tripo3D (geração + conversão FBX) |
| `worker/worker.js` | Proxy do Cloudflare: guarda as chaves, exige senha, resolve CORS |
| `.github/workflows/pages.yml` | Build e publicação automática no GitHub Pages |
| `blender/process_mesh.py` | Ferramenta local opcional: otimiza um .GLB no Blender e exporta FBX/GLB |

## Rodar no computador (desenvolvimento)

```bash
cd web
npm install
npm run dev     # http://localhost:3000
```

O Worker também pode ser publicado pelo terminal: `cd worker && npx wrangler deploy`
(e `npx wrangler secret put ACCESS_TOKEN`, etc.).
