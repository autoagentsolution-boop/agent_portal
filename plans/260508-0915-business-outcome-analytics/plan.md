# Business Outcome Analytics

**Created:** 2026-05-08
**Status:** in progress
**Branch:** main

## Goal

Surface per-agent business outcomes (leads classified, drafts approved, tickets triaged, etc.) plus estimated hours saved on the agent detail page. Existing operational analytics (success rate, p95 duration, cost) keep working as-is.

## Out of scope

- Workspace-level cross-template rollup (per-agent only)
- Export (CSV/PDF)
- Time-series trend charts (snapshot per range only)
- Manifest-driven extractor (hardcoded per-template; demo scope)

## Phases

| # | Name | Status |
|---|------|--------|
| 01 | Backend extractors + endpoint + FE Outcomes tab | in progress |

See `phase-01-business-outcome-analytics.md`.

## Key decisions

- **Compute on read** (no schema change). 65 demo execs + small N → trivial.
- **Per-template hardcoded extractor** in BE; registry maps `templateId → extractor + metadata`.
- **Range**: `7d`, `30d`, `all`. Rolling N×24h from now (no timezone math).
- **Hours saved**: estimated, with `estimated_basis` text returned so UI can show formula and pre-empt "where does that come from" challenge.
- **UI**: new "Outcomes" tab inside existing `agent-detail-page.tsx` (not new page).
