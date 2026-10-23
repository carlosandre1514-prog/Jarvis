# Gerador de Ativos 3D (100% grátis)

Site que transforma texto em modelos 3D prontos para game engine, funcionando no celular:
personagens de **corpo inteiro** (A-pose/T-pose), criaturas, objetos, armas, veículos e construções,
**coloridos** ou **só o modelo em branco**, com download em **.FBX** (Unreal/Unity) e **.GLB** (Godot/Web).

**Site:** https://carlosandre1514-prog.github.io/Jarvis/

Sem servidor, sem cartão e sem cobrança: o site é estático (GitHub Pages) e a IA roda na GPU gratuita
do Hugging Face, chamada direto do navegador.

```
texto ──FLUX.1-schnell──► imagem de referência ─┬─ Hunyuan3D-2 ──► modelo branco
                          (você aprova ou gera   └─ TRELLIS ──────► modelo colorido (textura)
                           outra)                         │
                                                          ▼
              otimização no navegador (polígonos, normais, escala real, origem no chão)
                                                          │
                              visualizador 360° ──► .FBX / .GLB / enviar para Drive, WhatsApp
```

## Como usar (celular ou PC)

1. Escolha o **tipo** e descreva o ativo (corpo, roupas, acessórios, proporções; em inglês costuma sair melhor).
2. Escolha **Colorido** ou **Só o modelo (branco)**, estilo e pose.
3. Toque em **Gerar imagem de referência**. Se não gostar (corpo cortado, pose errada), gere outra.
   Também dá para usar uma foto ou desenho seu.
4. Toque em **Transformar em 3D**. Leva de 20 s a 2 min.
5. Gire com o dedo, confira nos modos **Textura / Argila / Malha** e baixe o **.FBX** ou **.GLB**.
   Os modelos ficam salvos no aparelho, em "Seus modelos".

Dica: no Chrome do celular, use **⋮ → Adicionar à tela inicial** para abrir como app.

## Cota grátis

A GPU do Hugging Face é gratuita, mas tem cota diária:

- **Sem login**: dá para gerar o modelo **branco**; o **colorido** normalmente não cabe na cota anônima.
- **Com token grátis** (recomendado, sem cartão): toque em **Cota** no topo do site e siga o passo a passo.
  1. Crie uma conta em https://huggingface.co/join
  2. Abra https://huggingface.co/settings/tokens/new?tokenType=read, crie um token do tipo **Read** e copie
  3. Cole no site. Ele fica salvo só no seu aparelho.

Quando a cota acaba, o site avisa; ela se renova sozinha.

## Formatos

| Formato | Engine | Observações |
|---|---|---|
| .FBX | Unreal, Unity, Blender | Binário 7.4 com a textura embutida, metros, Y para cima |
| .GLB | Godot, Web, Unity (glTFast), Unreal 5 (Interchange) | Materiais PBR |

O modelo já sai na **altura real** escolhida (personagem 1,8 m, por exemplo), com a origem no chão.

## Estrutura

| Caminho | O que é |
|---|---|
| `web/` | Código do site (Next.js estático + Tailwind + React Three Fiber) |
| `web/lib/free3d.ts` | Chamadas à IA grátis (FLUX, Hunyuan3D-2, TRELLIS) pelo `@gradio/client` |
| `web/lib/prompt.ts` | Monta o prompt (corpo inteiro, pose, estilo, fundo branco) |
| `web/lib/optimize.ts` | Redução de polígonos (meshoptimizer), normais, escala, modo branco |
| `web/lib/fbx.ts` | Exportador FBX binário próprio |
| `blender/process_mesh.py` | Ferramenta local opcional para otimizar no Blender |
| `index.html`, `_next/`… (raiz) | Site compilado que o GitHub Pages publica |

## Atualizar o site

O GitHub Pages está configurado para publicar a **raiz** do branch. Depois de mudar algo em `web/`:

```bash
./publicar.sh          # compila e copia o site para a raiz
git add -A && git commit -m "Atualiza site" && git push
```
