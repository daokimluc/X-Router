# Bilingual README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default Next.js README with an evidence-based English–Vietnamese README that presents Foza/XRouter accurately to Codex for Open Source reviewers and OSS developers.

**Architecture:** Update only `README.md`. Structure the document with English-first sections followed by Vietnamese translations, explicitly separating Foza's web/control-plane responsibilities from the external X-Router gateway. Describe shipped buyer/provider/admin/payment/ledger behavior, live versus mock mode, and the planned use of Codex without claiming unsupported production scale or gateway functionality.

**Tech Stack:** Markdown, Mermaid, npm scripts from `package.json`, official OpenAI Codex for Open Source program link.

## Global Constraints

- The project is in public beta with a few internal users; do not call it production or claim broad adoption.
- This repository is not the complete X-Router gateway and has no `/v1/chat/completions` route.
- Marketplace is current functionality, but model subscription connects a model to a buyer key; token packs and wallet top-ups are separate payment flows.
- Live integration is enabled by `MARKETPLACE_ENABLED=true` or `XROUTER_ENABLED=true`; `.env.example` defaults to mock/offline mode.
- Target figures such as `120M+`, `150+`, `30+`, and `<2000ms` must be labeled as design targets, never achieved metrics.
- Do not claim complete provider analytics, automatic key wind-down on plan cancellation, full provider operations, uptime/SLOs, certifications, or production adoption.
- Do not modify application code or environment secrets.

### Task 1: Replace the default README

**Files:**
- Modify: `README.md`

**Content requirements:**

- Add an English-first hero and Vietnamese translation.
- Explain the problem and the Foza/X-Router boundary.
- List evidence-backed current capabilities: marketplace, keys, plans, wallet/payment, seller listings, admin controls, usage/settlement ledger, signed/idempotent webhooks, reconciliation, and server-only secrets.
- Include a Mermaid architecture diagram labeling X-Router as external.
- Include mock/live setup using `npm install`, `npm run dev`, `.env.example`, and the feature flag.
- Include the three ordered Codex support priorities: security/reliability/observability; maintainer automation; gateway/marketplace expansion.
- Include limitations and roadmap language that distinguishes shipped behavior from planned work.
- Include contribution, security, status, and official program links.

### Task 2: Verify the document

**Files:**
- Read: `README.md`, `package.json`, `.env.example`

**Checks:**

- Confirm the create-next-app template is gone.
- Confirm all code fences close and Mermaid syntax is structurally valid.
- Confirm quick-start commands exist in `package.json`.
- Confirm links use valid Markdown URLs and the Codex program link is official.
- Search for prohibited overclaims and ensure target numbers are qualified.
- Run a UTF-8 readback and, if available, a lightweight Markdown structure check without adding dependencies.
