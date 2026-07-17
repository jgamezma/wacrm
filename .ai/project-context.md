# Project Context

> **Project-owned file.** The sync script never overwrites it. Keep it current —
> this is the AI's map of what this project *is*.

## What is this project?

**wacrm** is a self-hostable CRM template for WhatsApp®: a shared team inbox on the
official WhatsApp Business API, contacts, sales pipelines, broadcasts, no-code
automations, and an AI reply assistant. It is shipped as a **template to fork and brand**,
not a hosted product. This repo is a fork of `ArnasDon/wacrm` maintained by IdeasLab.

## Domain glossary

- **Account** — the top-level tenant. Everything is account-scoped; one shared inbox can be
  staffed by a whole team. Solo use stays single-user with zero setup.
- **Member / role** — users in an account with a role: `owner` / `admin` / `agent` / `viewer`.
- **Conversation** — a WhatsApp thread with one contact; assignable, with status and notes.
- **Contact** — a person, with tags, custom fields; CSV import + phone dedup.
- **Pipeline / deal** — Kanban sales pipeline; deals link to conversations.
- **Broadcast** — bulk send using Meta-approved message templates, with per-recipient
  variable substitution and delivery/read tracking.
- **Automation / flow** — no-code trigger→condition→action rules; visual builder.
- **Template (Meta)** — a WhatsApp message template approved by Meta; required to open
  conversations outside the 24-hour session window.
- **wamid** — WhatsApp message id returned by Meta; used to correlate status webhooks.

## Users & stakeholders

- Primary users: small teams running customer comms over WhatsApp (support + sales agents).
- Operators: whoever forks and self-hosts the CRM (the "you own your data" audience).
- Stakeholders: IdeasLab (fork maintainer), upstream `ArnasDon/wacrm`.

## Success metrics

- Fast, reliable inbound→reply loop (response time visible on the dashboard).
- Broadcast deliverability and accurate delivery/read tracking.
- Clean self-host: a fork can be branded and deployed with minimal setup.

## Scope & non-goals

- In scope: WhatsApp Business API inbox, contacts, pipelines, broadcasts, automations,
  AI assistant + knowledge base, dashboard, team accounts, public REST API, MCP server.
- Out of scope: the marketing site + self-host docs (separate repo `ArnasDon/wacrm-site`);
  unofficial/unauthorized WhatsApp access (only the official Business API is used).

## Key constraints

- **WhatsApp Business API rules:** 24-hour customer service window; templated messages
  required outside it; Meta template approval; rate limits and quality ratings apply.
- **Multi-tenant isolation:** every query must be account-scoped. Supabase Row Level
  Security (RLS) is the enforcement boundary — never bypass it with the service role in
  request paths that serve user data.
- **BYO AI keys:** users bring their own OpenAI/Anthropic keys, stored **encrypted**; no
  per-seat AI fee and their data stays theirs.
- **Fork discipline:** this is a fork — extend under fork-owned paths; avoid patching
  upstream files so upstream can be merged cleanly.

## External integrations

- **Meta WhatsApp Business (Graph API + webhooks)** — send/receive messages, templates,
  message status, phone-number registration.
- **Supabase** — Postgres, Auth, Storage (avatars, chat/flow media), Realtime (inbox/
  presence), pgvector (semantic knowledge-base retrieval).
- **OpenAI / Anthropic** — AI reply drafting and embeddings (BYO key, encrypted).

## Environments & access

- Repos: this product repo (fork of `ArnasDon/wacrm`); site + docs in `ArnasDon/wacrm-site`.
- Deploy: Docker (`Dockerfile`) / Node hosting (e.g. Hostinger one-click).
- Config: environment variables — see `.env.local.example`. Secrets never in git;
  user AI keys are encrypted at rest.

## Open questions

- TODO — capture live decisions here as they come up.
