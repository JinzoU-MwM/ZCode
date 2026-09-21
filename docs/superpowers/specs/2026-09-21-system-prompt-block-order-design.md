# Order system prompt sections by cache stability

Date: 2026-09-21
Module: `zcode-cli` (`core/src/context/builder.ts`)

## Problem

The main agent system prompt is three `system` messages: CLI prefix, stable body (identity, desktop context), and one dynamic block. Measured with the default configuration the dynamic block is about 2.4k of 3.2k prompt tokens, and its section order mixes stability levels:

| section                | tokens (est.) | changes with                 |
| ---------------------- | ------------- | ---------------------------- |
| `dynamic_behavior`     | 1022          | install version              |
| `memory`               | 603           | workspace (memory root path) |
| `env_info`             | 63            | workspace, model             |
| `output_style`         | 11            | user setting                 |
| `context_management`   | 639           | install version              |
| `system_context` (git) | 65            | every session                |

Because `env_info` and `output_style` sit before `context_management`, a new workspace or session invalidates the cached prefix ~640 tokens earlier than necessary. On providers that look up cache hits at content block boundaries (Anthropic) the whole dynamic block is one unit, so any change misses all of it.

## Design

- `orderSectionsForInjection` is the single owner of section order. Dynamic system sections are now emitted install-stable first (`dynamic_behavior`, `session_guidance`, `context_management`, listed in `INSTALL_STABLE_DYNAMIC_SOURCES`), then the rest in their existing relative order (`memory`, `env_info`, `output_style`, `system_context`).
- `assembleSystemMessages` emits the dynamic sections as two `system` messages: the install-stable group and the volatile group. Each keeps the `"\n\n"` left boundary, so the OpenAI-compatible adapter, which joins leading system messages with `""`, produces byte-identical text to a single reordered block.
- Breakpoints: the AI SDK keeps only the first four `cache_control` markers in tools → system → messages order. The moving marker on the latest message must survive, so system markers stay at three: the CLI prefix marker (14 tokens) is dropped and the two dynamic blocks each get one.

Expected effect: for a new session or workspace on the same install, the cached prefix now extends through tools, identity and about 1.7k more tokens of install-stable guidance. Per-turn behaviour is unchanged.

## Testing

`core/test/context-system-blocks.test.ts` (node:test over `dist`): section order, four system messages, exactly three markers with none on the CLI prefix, dynamic block split, and concatenation identity.

## Out of scope

Subagent context builder (separate assembly, already three blocks). Splitting `env_info` to move the model line into the session tier.
