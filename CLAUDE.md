@AGENTS.md

# startupsHQ — project rules

- **Docs are the source of truth.** Start at `docs/README.md`. Requirements: `docs/SRS.md` · endpoint contract: `docs/API.md` · decisions: `docs/ARCHITECTURE.md` §10 · build sequence: `TODO.md`. When a change affects them, update docs downstream as `docs/README.md` describes.
- **Security first.** Nothing outside `src/server/**` may import from it. Never commit secrets, `.env` files, database dumps or private operational material — this repository is public.
- **Supply chain.** Don't loosen `pnpm-workspace.yaml` (`strictDepBuilds`, `allowBuilds`, `minimumReleaseAge`) without an explicit review.
- **Commits** go directly to `main`, continuously, one unit of work at a time; CI must stay green.
- **No AI attribution** in commits or pull requests — no `Co-Authored-By` or session trailers.
