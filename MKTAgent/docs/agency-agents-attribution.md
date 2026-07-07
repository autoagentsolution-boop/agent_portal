# Agency-Agents Attribution

This document credits the external persona research that informed our marketing agent registry enrichment (Phase 05-B, 2026-07-07).

## Source Repository

**[msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents)** (MIT License)  
A comprehensive collection of AI agent personas for business roles, available under MIT license. Used with permission for enrichment purposes only.

---

## Persona Mappings

The following marketing personas from `agency-agents/marketing/` informed our agent registry:

### Strategy Agent
- **Informed by**: `marketing-growth-hacker.md`
- **Enrichment**: Integrated LTV:CAC dynamics, retention benchmarks (Day 7/30/90), funnel-stage anchoring, and A/B-testable lead-scoring signals into decisionFramework and successMetrics.

### Content Search Agent
- **Informed by**: `marketing-seo-specialist.md`
- **Enrichment**: Incorporated data-driven rigor ("no guesswork"), SERP evidence grounding, competitive gap analysis, and attribution best practices into vibe and decisionFramework.

### Concept Writer Agent
- **Informed by**: 
  - `marketing-content-creator.md` — multi-format, multi-platform voice adaptation
  - `marketing-instagram-curator.md` — visual brand identity and authentic engagement
  - `marketing-linkedin-content-creator.md` — hook engineering and audience-specific playbooks
  - `marketing-carousel-growth-engine.md` — 6-slide narrative structure and visual legibility
- **Enrichment**: Added hook-first methodology, per-platform voice differentiation, and promptSections (role/goal/capabilities/constraints) for structured prompt generation. Introduced hook variants (curiosity gap, bold claim, story) and audience segmentation awareness.

### Infographic Agent
- **Informed by**: `marketing-carousel-growth-engine.md` (visual generation pipeline, quality gates)
- **Enrichment**: Enhanced successMetrics to include visual legibility verification and 90%+ first-attempt generation success, grounded in carousel-design quality-gate patterns.

### Storyboard Agent
- **Informed by**: `marketing-carousel-growth-engine.md` (6-slide narrative architecture)
- **Enrichment**: Added emphasis on visual consistency (product, color, style) and narrative flow between frames, adapted from carousel scene composition principles.

### Video Agent
- **Informed by**: `marketing-carousel-growth-engine.md` (autonomous pipeline, visual consistency)
- **Enrichment**: Introduced motion choreography (pan, zoom, fade, cut, hold), pacing per platform, and frame-to-frame transition awareness.

### Publisher Agent
- **Informed by**: `marketing-multi-platform-publisher.md`
- **Enrichment**: Integrated platform-fit matrix concept, draft-first protocol, platform-native adaptation (CTA, length, hashtags per platform), and added promptSections for structured multi-platform orchestration. Emphasized "zero blind publishes" principle.

---

## License

All enriched content in `src/orchestration/registry/agent-registry.ts` is derivative work, adapted and customized for our product context (multi-tenant marketing automation, multi-language support, DAG-based orchestration). Our adaptations remain under our project's existing license. The underlying `agency-agents` repository is MIT-licensed.

---

## Dates & Contributors

- **Mining Date**: 2026-07-07
- **Source Commit**: Latest main branch of `msitarzewski/agency-agents`
- **Enrichment**: Persona fields only (vibe, decisionFramework, successMetrics, promptSections). Core agent IDs, descriptions, requires/produces, and routing remain unmodified.
