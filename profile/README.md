<div align="center">

<img src="https://avatars.githubusercontent.com/u/274851014?s=140" alt="Bymax One logo" width="140" height="140" />

# BYMAX ONE

### 🏛️ Architecting intelligent, AI-native & Web3-ready systems.

**We build real systems, not demos.** A suite of production-grade, typed, multi-tenant
open-source libraries — engineered with discipline to remove vendor lock-in.

[![Website](https://img.shields.io/badge/🌐_Website-bymax.one-0ea5e9?style=for-the-badge)](https://bymax.one)
[![X](https://img.shields.io/badge/𝕏_Follow-@bymax__one-000000?style=for-the-badge)](https://x.com/bymax_one)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Bymax_One-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/company/bymax-one)
[![Instagram](https://img.shields.io/badge/Instagram-@bymax.one-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/bymax.one/)

<br />

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-Axum-000000?style=flat-square&logo=rust&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-000000?style=flat-square)

</div>

---

## 🏛️ Who We Are

**Bymax One** is a technology company that architects intelligent, AI-native and
Web3-ready systems. We operate **like an architecture firm, not an agency** — focused
on systems that scale, perform under load, and stay maintainable over time.

Everything we open-source is **typed end to end, multi-tenant ready, and vendor-neutral**,
with a production-first mindset: zero (or near-zero) direct dependencies, strict TypeScript,
and a runnable reference app for every library.

---

## 📦 Open-Source Ecosystem

Composable **NestJS 11** libraries (plus a Rust auth stack and a Claude Code toolkit).
Pick one, or compose the whole platform — each is independent and installable on its own.

#### 🧱 Foundation

| Library | What it does |
| --- | --- |
| 🧩 [`nest-core`](https://github.com/bymaxone/nest-core) | Application foundation kit — stable error envelope, request timing, offset/cursor pagination, health checks & optional Prometheus metrics |
| ⚙️ [`nest-config`](https://github.com/bymaxone/nest-config) | Type-safe environment config — Zod validation at bootstrap, aggregated fail-fast report, typed accessor & testing helpers |

#### 🔐 Auth & Security

| Library | What it does |
| --- | --- |
| 🔑 [`nest-auth`](https://github.com/bymaxone/nest-auth) | Full-stack auth for NestJS 11 · React 19 · Next.js 16 — JWT, MFA, OAuth, sessions, RBAC, multi-tenant SaaS ready. Zero external crypto deps |
| 🦀 [`rust-auth`](https://github.com/bymaxone/rust-auth) | Full-stack auth for Rust (Axum) & React/Next.js — pure-Rust crypto with WebAssembly edge verification (crates.io + npm) |

#### 🗄️ Data & Infrastructure

| Library | What it does |
| --- | --- |
| 🧰 [`nest-cache`](https://github.com/bymaxone/nest-cache) | Idiomatic Redis layer — typed cache helpers over ioredis, namespaced keys, Pub/Sub, atomic Lua & a managed connection lifecycle |
| 🗃️ [`nest-storage`](https://github.com/bymaxone/nest-storage) | Provider-agnostic object storage — one S3 API across AWS S3, Cloudflare R2, Backblaze B2, DO Spaces, MinIO & Wasabi |
| 📬 [`nest-queue`](https://github.com/bymaxone/nest-queue) | BullMQ-powered job queues — typed queues, workers, hierarchical flows & repeatable/cron jobs with safe retry defaults |

#### ⚡ Real-time & Messaging

| Library | What it does |
| --- | --- |
| 📡 [`nest-realtime`](https://github.com/bymaxone/nest-realtime) | Backend → frontend real-time — dual transport (SSE / WebSocket), multi-tenant rooms, event replay & Redis-backed scaling |
| 📨 [`nest-notification`](https://github.com/bymaxone/nest-notification) | Multi-channel notifications — email, OTP, SMS & push behind provider-agnostic interfaces (Resend, SES, Twilio, FCM…) |

#### 🔭 Observability & AI

| Library | What it does |
| --- | --- |
| 📊 [`nest-logger`](https://github.com/bymaxone/nest-logger) | Structured JSON logging (Pino 10) — OpenTelemetry trace correlation, PII/LGPD redaction & pluggable destinations |
| 💸 [`nest-ai-tokens`](https://github.com/bymaxone/nest-ai-tokens) | AI token & cost ledger — immutable usage ledger + historical pricing across OpenAI, Anthropic, Gemini, Mistral & OpenRouter |

#### 🛠️ Developer Tooling

| Project | What it does |
| --- | --- |
| 🤖 [`bymax-claude-code`](https://github.com/bymaxone/bymax-claude-code) | Production-ready Claude Code toolkit — phased workflow, strict quality gates & specialist review agents for TypeScript & Rust |

> 📘 **Every library ships with a runnable reference app** (`*-example`) — a full NestJS + Next.js
> implementation proving each feature end to end. Start with
> [`nest-auth-example`](https://github.com/bymaxone/nest-auth-example) or
> [`nest-cache-example`](https://github.com/bymaxone/nest-cache-example).

---

## 🚀 Getting Started

Each library is published under the `@bymax-one` scope and installs on its own:

```bash
pnpm add @bymax-one/nest-auth        # or nest-cache, nest-logger, nest-queue, …
```

Then explore the matching `*-example` repo for a copy-pasteable, production-shaped setup.

---

## 🧠 What We Build

| Pillar | Focus |
| --- | --- |
| 🤖 **AI-Native Architecture** | Modular design with LLM reasoning at the core — stateful memory, observable pipelines |
| 🔍 **RAG & Retrieval** | Production embeddings, vector search, hybrid retrieval + reranking, grounding |
| 🧩 **LLM Integration** | Structured outputs, schema validation, function calling & tool orchestration |
| 🛡️ **Validation & Safety** | Deterministic guardrails, schema enforcement, input/output filtering |
| ⛓️ **Web3-Ready Engineering** | Wallet auth, transaction signing, smart-contract interaction, tokenization |

---

## ⚙️ How We Build

```
🔎 Discover  →  🏗️ Architect  →  🧱 Build  →  🚀 Deploy  →  🔁 Iterate
```

- 💰 **Cost-aware** — LLM usage tracking and optimization built in
- 👁️ **Observable** — full pipeline visibility, structured logs & tracing
- 🛡️ **Reliable** — production-grade error handling, schema validation, security-first
- 🧪 **Proven** — strict TypeScript, high test coverage, mutation-tested libraries

---

## 🌐 Connect

**[🌍 bymax.one](https://bymax.one)** · **[𝕏 @bymax_one](https://x.com/bymax_one)** · **[in Bymax One](https://linkedin.com/company/bymax-one)** · **[📷 @bymax.one](https://www.instagram.com/bymax.one/)**

<div align="center">

<br />

**Architecting AI-native systems for production.**

</div>
