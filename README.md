# Gerador de Ativos 3D com IA

Texto → modelo 3D com texturas PBR → otimizado no Blender → download em **.FBX** (Unreal/Unity) ou **.GLB** (Godot/Web).

```
[1. Prompt do usuário]            web/app/page.tsx
        │
[2. Backend chama a API de IA 3D] server/src/providers/ (Meshy, Tripo3D)
        │
[3. Modelo bruto .GLB em /temp]   server/src/jobs.js
        │
[4. Blender headless otimiza]     blender/process_mesh.py
        │
[5. Visualizador 360° Three.js]   web/components/ModelViewer.tsx
        │
[6. Download .FBX / .GLB]
```

## Estrutura

| Pasta | O que é |
|---|---|
| `web/` | Next.js 14 + Tailwind + React Three Fiber. Visualizador 360° para .GLB e .FBX (inclusive arquivos locais). |
| `server/` | Node.js/Express. Recebe o prompt, chama a IA, baixa o .GLB, roda o Blender e serve os arquivos. |
| `blender/process_mesh.py` | Script `bpy`: limpeza da malha, decimação, verificação/geração de UV, exporta FBX + GLB. |

## Requisitos

- Node.js 20+
- [Blender 4.x ou 5.x](https://www.blender.org/download/) instalado (só é usado em modo `--background`, sem interface)
- Chave de API do [Meshy](https://www.meshy.ai/api) e/ou do [Tripo3D](https://platform.tripo3d.ai/)

## Como rodar

```bash
# 1) Backend
cd server
cp .env.example .env      # coloque MESHY_API_KEY / TRIPO_API_KEY e BLENDER_PATH
npm install
npm run dev               # http://localhost:4000

# 2) Frontend (em outro terminal)
cd web
npm install
npm run dev               # http://localhost:3000
```

O frontend encaminha `/api/*` e `/files/*` para o backend (mude com a variável `API_URL`).

Sem chave de API? Escolha o motor **Demo**: o Blender cria um modelo de exemplo e o resto do pipeline
(otimização, visualização, download) roda normalmente.

### `BLENDER_PATH`

- Windows: `C:\Program Files\Blender Foundation\Blender 4.2\blender.exe`
- macOS: `/Applications/Blender.app/Contents/MacOS/Blender`
- Linux: `blender` (se estiver no PATH)

## API do backend

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/providers` | Motores disponíveis (quais têm chave configurada) |
| `POST` | `/api/generate` | `{ "prompt": "...", "provider": "meshy" \| "tripo" \| "demo", "targetFaces": 20000 }` → job |
| `GET` | `/api/jobs/:id` | Status, progresso, estatísticas e links dos arquivos |
| `GET` | `/files/:id/model.fbx` · `model.glb` · `raw.glb` | Arquivos gerados |

## Script do Blender sozinho

```bash
blender --background --factory-startup --python blender/process_mesh.py -- \
  --input modelo.glb --output-dir ./saida --name meu_asset --target-faces 15000
```

O que ele faz:
1. Importa .GLB / .GLTF / .FBX / .OBJ
2. Junta vértices duplicados e recalcula as normais
3. Decimação (Collapse) até o número alvo de faces, respeitando costuras de UV
4. Confere o mapa UV; se faltar ou estiver degenerado, gera com Smart UV Project
5. Extrai as texturas PBR (albedo, normal, roughness/metallic) e exporta:
   - `.fbx` com texturas embutidas, escala/eixos para Unreal e Unity
   - `.glb` com materiais PBR para Godot e Web

## Texturas PBR

- **Meshy**: gera em duas etapas, `preview` (malha) e depois `refine` com `enable_pbr: true`.
- **Tripo3D**: `text_to_model` com `texture: true, pbr: true`.

## Próximos passos possíveis

- Trocar a fila em memória (`server/src/jobs.js`) por Redis/BullMQ para vários usuários
- Adicionar Hunyuan3D ou Luma Genie criando um arquivo novo em `server/src/providers/`
- Imagem → 3D (as duas APIs também aceitam isso)
