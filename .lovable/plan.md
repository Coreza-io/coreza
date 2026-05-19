# Fix AI Agent dark-mode invisible text + modernize icon

## Issues

1. In dark theme, the AI Agent node's System Prompt and User Prompt textareas show white-on-white text (image 492). The Max Iterations `Input` is fine because it themes via `bg-background text-foreground` — the raw `<textarea>` does not.
2. The current AI Agent icon is the OpenAI logo (`/assets/icons/openai.svg`). Replace it with a modern, provider-neutral agent mark.

## Changes

### 1. `src/components/nodes/layout/components/NodeFieldRenderer.tsx`

In the `case "textarea"` branch (around line 427), add design-system tokens to the textarea className so it themes in both light and dark mode:

```tsx
className="w-full border border-input bg-background text-foreground placeholder:text-muted-foreground rounded p-2 text-sm min-h-[100px] nodrag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
```

No other props change. This fixes every node that uses a `textarea` field (AI Agent, plus any other prompt/notes fields), not just AI Agent.

### 2. New icon `public/assets/icons/aiagent.svg`

Add a modern agent icon — a stylized bot head with a single antenna and sparkle accent, drawn with `stroke="currentColor"` so it inherits the node's icon color. Replaces the OpenAI logo on this node only; OpenAI ChatModel/LLM nodes keep `openai.svg`.

### 3. `src/nodes/AIAgent.json`

Change `"icon": "/assets/icons/openai.svg"` to `"icon": "/assets/icons/aiagent.svg"`. No other field changes.

## Verification

- Toggle light/dark theme: System Prompt and User Prompt text is readable in both themes; placeholder is muted; focus ring renders.
- AI Agent node header shows the new modern bot icon instead of the OpenAI mark. Other AI nodes (ChatModel/LLM with OpenAI) are unchanged.
