# startupsHQ

A startup directory where the relationships are the product — startups, founders, investors and accelerator batches as one connected graph.

**Status:** in development — Phase 0 (scaffold & tooling).

## Documentation

Start at [docs/README.md](./docs/README.md). The build sequence lives in [TODO.md](./TODO.md).

| Document | Purpose |
|---|---|
| [PRD](./docs/PRD.md) | What we're building and why |
| [SRS](./docs/SRS.md) | Requirements: schema, security, performance |
| [API](./docs/API.md) | Endpoint contract |
| [Architecture](./docs/ARCHITECTURE.md) | Design and decision records |
| [Test plan](./docs/TEST_PLAN.md) | How it's verified |

## Local development

Prerequisites: Node 24, Docker with Compose v2.

```bash
corepack enable pnpm   # pnpm version comes from package.json
pnpm install
pnpm dev               # http://localhost:3000
```

## Security

Please report vulnerabilities privately through GitHub's **Security → Report a vulnerability**, not in public issues.

## License

Copyright © 2026 sanskarmishra479. All rights reserved.

This repository is public for transparency, but no license is granted: you may not copy, modify, distribute or use this code without written permission.
