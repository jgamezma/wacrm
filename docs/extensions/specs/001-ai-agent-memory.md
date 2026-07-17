# Spec 001 — AI agent memory

| Field | Value |
|-------|--------|
| Status | **Implemented** (v1 `9001_…`; v2 auto-write `9002_…`) |
| Owner | IdeasLab (fork) |
| Related upstream | `ai_configs` (029), knowledge base (030), `buildConversationContext` |
| Fork path | `docs/extensions/specs/` (this file) |

## 1. Problem

Today the AI reply assistant only sees:

1. The account **system prompt** and optional **knowledge base** (account-wide FAQ/docs).
2. The last **N text messages** of the *current* conversation — `N` is a server env
   default (`AI_CONTEXT_MESSAGE_LIMIT`, default 20), not something admins set in
   **Settings → AI**.

That means:

- Facts about a **contact** (preferences, order context, prior issues) disappear when
  the thread is long, closed, or a new conversation starts with the same person.
- Operators cannot tune how much recent chat the model should read without redeploying
  env vars.

## 2. Goals

1. **Durable memory** per contact, stored in **Supabase**, account-scoped with RLS.
2. **Configurable context window** in agent setup: how many recent conversation lines
   (text messages) to load when drafting or auto-replying.
3. When generating a reply, the model receives: system prompt + knowledge (existing) +
   **contact memory** + **recent conversation lines** (limit from config).
4. Implement under **fork-owned paths** so upstream merges stay low-conflict.

## 3. Non-goals (v1)

- Cross-account or global shared memory.
- Vector/semantic search over memory (reuse knowledge-base embeddings later if needed).
- Automatic multi-hop “memory agent” with tools — v1 is read/write of structured notes.
- Editing memory from the public REST API / MCP (can follow once core is stable).
- Changing Meta WhatsApp message retention; memory is our CRM store, not WhatsApp’s.

## 4. User stories

### US-1 — Configure context lines

**As** an account admin  
**I want** to set how many recent conversation messages the AI reads  
**So that** I can trade off cost/latency vs continuity without changing server env.

**Acceptance**

- Given AI settings are editable, when I set “Conversation context messages” to a value
  in the allowed range and save, then draft and auto-reply use that limit.
- Given no value was ever saved, the effective default matches today’s behaviour (20).
- Env `AI_CONTEXT_MESSAGE_LIMIT` remains a **ceiling / emergency override** (optional) or
  is documented as deprecated in favour of the DB setting — pick one in implementation;
  prefer DB setting wins when present.

### US-2 — Remember facts about a contact

**As** an agent (or the AI on behalf of the account)  
**I want** notes about a contact to persist across conversations  
**So that** the assistant does not ask again for known preferences or context.

**Acceptance**

- Given a contact with memory entries, when AI drafts or auto-replies in any of that
  contact’s conversations, those entries are included in the prompt (within a size cap).
- Memory is keyed by `contact_id` (+ `account_id`); deleting a contact cascades memory.
- Members with inbox access can read memory for contacts they can already see; only
  roles that can edit settings (or a narrower “agent+” write policy — see open questions)
  can create/update/delete entries in v1 UI.

### US-3 — Source of memory writes

**As** the product  
**I want** a clear v1 write path  
**So that** memory stays trustworthy and reviewable.

**Acceptance (v1)**

- Manual CRUD from the contact (or conversation) UI is supported.
- Optional: after an AI turn, the model may propose a short memory upsert (structured),
  but **human confirmation** or a strict “auto-save only high-confidence facts” flag is
  required before silent writes — default **off** for auto-write.

## 5. Concepts

| Term | Meaning |
|------|---------|
| **Conversation context lines** | Last N *text* messages in the current conversation (existing `buildConversationContext` behaviour). |
| **Contact memory** | Durable, account-scoped notes tied to a `contacts.id`, independent of any one conversation. |
| **Knowledge base** | Account-wide docs (upstream 030) — *not* per-contact; memory must not replace KB. |

```
generateReply inputs (conceptual)
├── system prompt (account)
├── knowledge excerpts (account, retrieved)
├── contact memory (contact_id)          ← NEW
└── recent messages (limit from config)  ← configurable in setup (was env-only)
```

## 6. Data model (Supabase)

### 6.1 Config — context line limit

Prefer an **additive column** on `ai_configs` (low surface area; mirrors other AI
settings). Upstream may add columns later; conflicts are usually trivial merges.

```sql
-- Illustrative; real migration lives under supabase/migrations/ with next free number
ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS context_message_limit integer NOT NULL DEFAULT 20
    CHECK (context_message_limit BETWEEN 5 AND 100);
```

- Bound the range (suggested **5–100**) to protect token spend on BYO keys.
- UI: number input on the existing AI agent setup panel.
- Runtime: `loadAiConfig` exposes `contextMessageLimit`; `buildConversationContext(..., limit)`
  uses it instead of (or after) `aiContextMessageLimit()`.

**Fork-safer alternative** (if we must avoid touching `ai_configs`): table
`ai_extension_settings (account_id PK, context_message_limit, …)` with the same RLS
pattern as `ai_configs`. Prefer the column unless upstream churn on `ai_configs` is high.

### 6.2 Contact memory table (fork-owned)

New table — does not fork-patch upstream message/contact schemas beyond FKs:

```sql
CREATE TABLE ai_contact_memories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  -- Short label for UI lists (e.g. "Preferred language", "Last order")
  title        text,
  -- Body injected into the prompt
  content      text NOT NULL,
  -- Origin for audit / filtering
  source       text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('manual', 'ai_suggested', 'import')),
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_ai_contact_memories_account_contact_title
    UNIQUE NULLS NOT DISTINCT (account_id, contact_id, title)
);

CREATE INDEX ai_contact_memories_contact_id_idx
  ON ai_contact_memories (contact_id);

CREATE INDEX ai_contact_memories_account_contact_idx
  ON ai_contact_memories (account_id, contact_id);
```

**RLS (align with inbox data, not settings-only):**

- SELECT: `is_account_member(account_id)` (same bar as reading contacts).
- INSERT/UPDATE/DELETE: at least `agent`+ (or `admin`+ if we want memory admin-only in v1).
- Auto-reply / draft under service role: load memory by `account_id` + `contact_id` like KB retrieval.

**Prompt budget:** when loading for generation, take the **most recently updated** K entries
(suggested default K = 20) and truncate total characters (e.g. 4k) so memory cannot blow
the context window.

### 6.3 Optional later

- Soft-delete / `is_active`.
- `embedding vector` for semantic memory recall.
- Per-memory TTL / expiry for GDPR-style retention.

## 7. Runtime behaviour

### 7.1 Read path (draft + auto-reply)

1. Resolve conversation → `contact_id`, `account_id`.
2. Load AI config → `context_message_limit`.
3. `buildConversationContext(db, conversationId, config.contextMessageLimit)`.
4. `loadContactMemory(db, accountId, contactId)` → format as a system-prompt section
   (same pattern as knowledge excerpts in `buildSystemPrompt`).
5. Generate as today.

If `contact_id` is null (orphan conversation), skip memory silently.

### 7.2 Write path (v1)

| Path | Behaviour | Status |
|------|-----------|--------|
| Manual UI | CRUD on contact detail (Memory tab). | **v1 shipped** |
| AI auto-write | On conversation **close**, the AI summarises the thread into `{ title, content }` facts and **inserts** them with `source = 'ai_suggested'`. Gated by `ai_configs.memory_autowrite_enabled` (opt-in, off by default). | **v2 shipped** |

**Auto-write specifics (v2):**

- Trigger: inbox **close** action → fire-and-forget `POST /api/ai/memory/summarize`.
  (Automation-driven closes and a per-turn trigger are not wired in v2.)
- Extraction reuses the account's provider via `generateReply` with a JSON-only
  extraction prompt; `extractMemoryFacts` parses/validates/clamps the output
  (≤ `MAX_EXTRACTED_FACTS`, per-field length caps).
- **Never overwrites human memory:** insert uses `ignoreDuplicates` on
  `(account_id, contact_id, title)`, so the AI only *adds* facts it hasn't recorded;
  a manual entry with the same title is left untouched. Known facts are fed back into
  the prompt so the model doesn't re-propose them.
- Best-effort: `summarizeConversationToMemory` never throws — a failed summarisation
  must not break closing a conversation.

Do **not** dump full chat transcripts into memory; store concise facts only.

### 7.3 Prompt shape (additive)

Extend `buildSystemPrompt` (or a thin fork wrapper) with an optional `memory?: string[]`
block, clearly labelled as contact-specific notes, untrusted as instructions (same
injection hygiene as customer messages / KB).

## 8. API / UI surface (v1)

| Surface | Notes |
|---------|--------|
| `GET/PUT /api/ai/config` | Include `context_message_limit` in read/write payload. |
| `GET/POST /api/ai/memory?contact_id=` | List / create (account-scoped). |
| `PATCH/DELETE /api/ai/memory/[id]` | Update / delete one entry. |
| Settings → AI | Number field for context lines. |
| Contact UI | Memory list + add/edit. |

Prefer route handlers under `src/app/api/ai/memory/…` and domain code under
`src/lib/extensions/ai-memory/` (or `src/lib/ai/memory.ts` if the team accepts a small
upstream-adjacent file). Prefer **new files** over large edits to `generate.ts` /
`auto-reply.ts` — call hooks from one or two integration points.

## 9. Fork conflict strategy

| Concern | Approach |
|---------|----------|
| Specs / product docs | Only under `docs/extensions/**` — never edit upstream `docs/mcp.md` / `docs/public-api.md` for this feature. |
| Schema | New `ai_contact_memories` table + optional additive `ai_configs.context_message_limit`. Migration name clearly IdeasLab (comment header). |
| App code | New modules for memory CRUD + prompt formatting; minimal call-site patches in draft/auto-reply. |
| UI | New contact-memory component; small additive fields on existing AI settings (accept merge cost) **or** a separate “AI memory” settings card in a fork-owned settings section if AI settings churn is high. |
| Tests | Colocated unit tests for load/format/limit; do not rely on changing upstream snapshots unnecessarily. |

## 10. Security & tenancy

- Every query **account-scoped**; RLS on the new table verified in migration review.
- Memory content is **PII** — treat like contact notes; no logging of full memory bodies in
  provider error breadcrumbs.
- Prompt injection: label memory as data; never execute as system instructions from the contact.
- BYO keys unchanged (ADR-003).

## 11. Success metrics

- Admins can change context line count in UI and observe different transcript length in
  playground / draft behaviour.
- Replies in a *new* conversation with the same contact can reference a manually saved
  memory fact without that fact appearing in the recent messages.
- Upstream merge of `ai_*` migrations does not require rewriting this spec or deleting
  the memory table.

## 12. Implementation outline (when building)

1. Migration: `context_message_limit` + `ai_contact_memories` + RLS.
2. Config API + settings UI field.
3. `loadContactMemory` + wire into draft + auto-reply (+ playground).
4. Contact UI CRUD + API routes.
5. Tests: context limit from config; memory included / skipped when no contact; RLS smoke.
6. Update `.ai/architecture.md` data-model bullet + this spec Status → Accepted/Implemented.

## 13. Open questions — resolved for v1

1. **Write ACL:** **agent+** may create/update/delete; any member (viewer+) may read
   (operational-data RLS, mirroring `contacts`/`contact_notes`).
2. **Auto-write:** v1 manual-only; **v2 adds opt-in auto-write** on conversation close
   (`memory_autowrite_enabled`, off by default), inserting `source = 'ai_suggested'`
   facts without overwriting manual entries. See §7.2.
3. **Unique `title`:** **enforced** — `UNIQUE NULLS NOT DISTINCT (account_id, contact_id,
   title)`. The create/update API returns **409** on collision (`code: duplicate_title`).
   v1 UI/API require a non-empty title (column stays nullable for future import/AI use).
4. **Env override:** **DB setting wins; `AI_CONTEXT_MESSAGE_LIMIT` kept as an optional
   emergency *ceiling*** (`resolveContextMessageLimit` — can only lower, never raise).
5. **Empty contact conversations:** memory attaches by `contact_id` at generation time; an
   orphan conversation (`contact_id` null) skips memory silently and picks it up once linked.

## 14. Decision log

| Date | Decision |
|------|----------|
| 2026-07-16 | Spec drafted; store under `docs/extensions/specs/` for fork isolation. |
| 2026-07-16 | Memory associated to `contact_id`; context line count configurable in agent setup; persistence in Supabase. |
| 2026-07-16 | v1 implemented: migration `9001` (fork-reserved 9000+ band), `loadContactMemory` under `src/lib/extensions/ai-memory/`, memory block in `buildSystemPrompt`, wired into draft + auto-reply, `/api/ai/memory` CRUD, Settings → AI context field, contact Memory tab. Open questions resolved (agent+ writes, manual-only, unique title→409, env-as-ceiling). |
| 2026-07-16 | v2 auto-write: migration `9002` (`memory_autowrite_enabled`, opt-in/off). `summarizeConversationToMemory` + `extractMemoryFacts` under `src/lib/extensions/ai-memory/summarize.ts`; `POST /api/ai/memory/summarize`; triggered fire-and-forget from the inbox close action; inserts `source='ai_suggested'` facts (ignore-duplicates, never clobbers manual); Settings → AI toggle; "AI" badge on suggested entries in the Memory tab. |
