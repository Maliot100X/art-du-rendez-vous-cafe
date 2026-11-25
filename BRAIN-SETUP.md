# Cerveau LLM — mise en place (BRAIN-SETUP.md)

Le chat de l'agent (onglet **Agent**) et le mini-chat de Vita (onglet
**La Carte**) passent tous les deux par le même adaptateur :
`src/lib/brain.ts`. Tant qu'aucune clé n'est configurée, les deux
répondent avec le cerveau hors ligne déjà intégré (règles sur la carte,
les horaires, l'adresse) — le site fonctionne normalement, et l'interface
affiche honnêtement l'état hors ligne. Dès qu'une clé valide est en place
et que le premier appel LLM réussit, l'agent répond avec le cerveau LLM
et l'état passe à « cerveau connecté ».

**Ne jamais mettre la clé dans le code, dans un commit, ni dans un
message.** Elle vit uniquement dans les variables d'environnement
ci-dessous.

## 1. Les variables exactes

| Variable | Rôle | Exemple |
|---|---|---|
| `VITE_LLM_API_KEY` | Clé API du LLM (obligatoire pour activer le cerveau) | `sk-…` |
| `VITE_LLM_BASE_URL` | URL de base, compatible OpenAI (facultatif) | `https://api.openai.com/v1` |
| `VITE_LLM_MODEL` | Modèle de chat (facultatif) | `gpt-4o-mini` |

Seule `VITE_LLM_API_KEY` est obligatoire. Sans elle, le site reste en
mode hors ligne.

**Alias reconnus** (si les `VITE_LLM_*` ne sont pas définies) :
`VITE_FREELLM_API_KEY` / `VITE_FREELLM_BASE_URL` — la passerelle
freellm est compatible OpenAI, elle se branche ici telle quelle ; dans
ce cas le modèle par défaut est `auto`.

## 2. Où les mettre

**Aperçu local** — créer un fichier `.env.local` à la racine de
`pro-studio/` (à côté de `package.json`), jamais commité (`.env*` est
déjà dans `.gitignore`) :

```
VITE_LLM_API_KEY=sk-votre-cle-ici
VITE_LLM_BASE_URL=https://api.openai.com/v1
VITE_LLM_MODEL=gpt-4o-mini
```

Puis reconstruire et prévisualiser :

```
npm run build
npm run preview
```

**Déploiement Vercel** — tableau de bord Vercel → projet → Settings →
Environment Variables, ajouter les trois mêmes variables (Production),
puis redéployer. Les variables `VITE_*` sont intégrées au build :
changer une valeur exige un nouveau déploiement.

## 3. Quels modèles utiliser

N'importe quel modèle de chat compatible OpenAI (`/chat/completions`) :

- **OpenAI** : `gpt-4o-mini` (recommandé — rapide, pas cher),
  `gpt-4o`, `gpt-4.1-mini`.
- **Passerelle freellm** : `auto` (défaut quand la clé vient de
  `VITE_FREELLM_API_KEY`), ou `auto:fast` pour le mode rapide.
- **Autre passerelle compatible OpenAI** : le nom de modèle qu'elle
  expose (mettre aussi sa `VITE_LLM_BASE_URL`, sans `/chat/completions`
  à la fin — l'adaptateur l'ajoute).

## 4. Comment l'avatar « se configure tout seul »

Il n'y a rien d'autre à brancher. L'adaptateur (`askBrain`) renvoie
exactement la même forme de réponse que le cerveau hors ligne — texte,
boutons « Ajouter » éventuels, et **expression du visage** — donc le
chemin est unique :

1. Le visiteur écrit dans le chat (Agent ou Vita).
2. `askBrain` appelle le LLM avec un prompt système construit à partir
   des données du site lui-même (toute la carte avec les 62 prix,
   les horaires, l'adresse, le parcours de commande — voir
   `brainSystemPrompt()` dans `src/lib/brain.ts`). Le cerveau connaît
   le café et n'a pas à inventer un prix, un horaire ou une adresse.
3. La réponse revient, l'expression du visage est déduite du texte
   (joie, surprise, réflexion…), la VRM / Live2D l'adopte via le pont
   d'avatar (`avatarBridge`), et la réponse est lue à voix haute par
   la voix du navigateur — exactement comme avant, mais avec les mots
   du LLM.

Autrement dit : **mettre la clé suffit**. L'avatar répond avec le
cerveau LLM et pilote ses propres expressions ; retirer la clé (ou une
panne du service) fait retomber le chat sur le cerveau hors ligne,
sans rien casser.

## 5. Comment tester

1. Mettre les variables dans `.env.local` (voir §2), puis
   `npm run build` (le build doit passer).
2. Ouvrir le site, aller sur l'onglet **Agent**, et poser une question
   que le cerveau hors ligne ne sait pas formuler — par exemple :
   « J'ai envie de quelque chose de frais et pas trop fort, tu me
   conseilles quoi pour un premier rendez-vous ? »
3. **Réussi** : la réponse est une phrase naturelle et nouvelle (pas
   la réponse standard du cerveau hors ligne), et la pastille d'état
   passe à « Agent en direct — cerveau connecté ». Dans l'onglet
   **La Carte**, la note sous le mini-chat de Vita passe à
   « Cerveau LLM en ligne ».
4. **Échec** : la pastille reste sur l'état hors ligne et le chat
   répond quand même (avec le cerveau hors ligne). Vérifier alors,
   dans l'ordre : la clé est-elle la bonne ? `VITE_LLM_BASE_URL`
   pointe-t-elle sur le bon service (sans `/chat/completions`) ?
   Le modèle existe-t-il sur ce service ? Le service est-il joignable
   (pare-feu, port ouvert) ? **Aucune clé n'apparaît jamais dans les
   logs du navigateur** — si une erreur s'affiche, elle ne contient
   que le statut HTTP.

## 6. Limites connues

- Le chat texte uniquement : la **voix en direct** (Deepgram) est un
  système séparé, avec sa propre clé — ce fichier ne la configure pas.
- L'appel LLM a un délai maximum de 12 s ; au-delà, le chat répond
  hors ligne plutôt que de laisser le visiteur attendre.
- Les réponses du LLM sont limitées à ~1200 caractères : courtes,
  comme une conversation au bar.
- La clé est intégrée au bundle JavaScript livré au navigateur
  (contrainte des variables `VITE_*`) : c'est acceptable pour une clé
  de passerelle personnelle, mais pour une clé OpenAI à facturation
  ouverte, préférer un petit backend mandataire plus tard.
