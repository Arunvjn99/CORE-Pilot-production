# ADR-0005: LLM Gateway

Status: **Proposed — LiteLLM evaluation pending (Phase 3)**

## Context

Runtime-configurable providers/keys, per-agent model assignment, snapshot per execution, no direct SDK use in agents.

## Options

1. Own gateway with thin adapters. 2. LiteLLM Python SDK as adapter layer inside our gateway. 3. LiteLLM Proxy server.

## Proposed decision

Our own `llm_gateway` module in the AI runtime owns registry, credential resolution, policy, snapshots, usage/cost and audit; it **may** use the LiteLLM SDK (option 2) purely as the provider-adapter layer, behind our interface, so it can be replaced. The LiteLLM Proxy (own DB, own key model) is not adopted, to keep one credential/security model.

## Open items before acceptance

LiteLLM licence (core MIT, `enterprise/` commercial) and vulnerability history review; capability-metadata accuracy; streaming/tool-call normalisation tests per provider.
