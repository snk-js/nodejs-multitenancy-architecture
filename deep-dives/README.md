# Deep Dives

Research-backed extensions beyond the core 13-epoch course. Read them **after** the epochs — each leans on vocabulary and decisions the course established (sessions from Epoch 04, tenancy from Epochs 06–07, observability from Epoch 10, the scaling philosophy from Epoch 12).

| # | Topic | What it answers |
|---|---|---|
| [01](01-advanced-auth-architectures.md) | **Advanced Auth Architectures** | How auth grows up: OAuth 2.1 + OIDC, refresh-token rotation as a theft alarm, the BFF pattern, per-tenant enterprise SSO (SAML/OIDC), SCIM, MFA & passkeys, machine-to-machine identity, and the build-vs-buy line |
| [02](02-backend-for-microfrontends.md) | **The Backend's Job in a Microfrontend World** | Serving many independent UIs: immutable hashed assets, version skew, deploy manifests, composition patterns (zones vs federation vs import maps), and package/version governance across teams |
| [03](03-nextjs-multitenancy-and-microfrontends.md) | **What Modern Next.js Solves** | Next.js 16 (`proxy.ts`, Cache Components) for multi-tenant apps, the subdomain→rewrite pattern, why Multi-Zones beat Module Federation, and exactly where the framework ends and your Epoch 06–07 machinery remains irreplaceable |
| [04](04-observability-across-the-frontend-boundary.md) | **Observability Across the Frontend Boundary** | Tracing bugs across independently-deployed frontends: W3C trace context from the browser, who owns the tracer, session continuity across zone navigations, source maps + build ids, per-mfe error attribution, and the triage playbook |
| [05](05-infrastructure-as-code.md) | **Infrastructure as Code** | Desired state & reconciliation, OpenTofu/Terraform/Pulumi/Crossplane in 2026, module & environment structure, plan-on-PR pipelines with policy and cost gates, secrets, drift, and the sharp line between tenant provisioning (app) and tenant *infrastructure* (IaC) |
| [06](06-running-it-all-locally.md) | **Running It All Locally** | The laptop lab: two-replica Compose stack with tracing and fault injection, realistic seeding, an experiment catalogue that makes every scalability failure visible, when to graduate past Compose — and how to sequence the actual business without building Epoch 12 on day one |

Three threads run through all six:

- **Frameworks and providers resolve *names* (which tenant, which zone, which identity); your data layer enforces *grants*.** Nothing here replaces the course's isolation machinery.
- **Every boundary needs a join key.** `tenantId` for the backend (Epoch 10), `session.id` + `mfe.version` across frontends (04), tags for infrastructure (05). Identity threads are what make distributed systems debuggable.
- **Shrink the limits instead of growing the load** (06) — the local lab is where the other five documents stop being theory.
