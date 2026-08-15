# Deep Dives

Research-backed extensions beyond the core 13-epoch course. Read them **after** the epochs — each one leans on vocabulary and decisions the course established (sessions from Epoch 04, tenancy from Epochs 06–07, the scaling philosophy from Epoch 12).

| # | Topic | What it answers |
|---|---|---|
| [01](01-advanced-auth-architectures.md) | **Advanced Auth Architectures** | How auth grows up: OAuth 2.1 + OIDC, refresh-token rotation as a theft alarm, the BFF pattern, per-tenant enterprise SSO (SAML/OIDC), SCIM, MFA & passkeys, machine-to-machine identity, and the build-vs-buy line |
| [02](02-backend-for-microfrontends.md) | **The Backend's Job in a Microfrontend World** | Serving many independent UIs: immutable hashed assets, version skew, deploy manifests, composition patterns (zones vs federation vs import maps), and package/version governance across teams |
| [03](03-nextjs-multitenancy-and-microfrontends.md) | **What Modern Next.js Solves** | Next.js 16 (`proxy.ts`, Cache Components) for multi-tenant apps, the subdomain→rewrite pattern, why Multi-Zones beat Module Federation, and exactly where the framework ends and your Epoch 06–07 machinery remains irreplaceable |

A shared thread across all three: **frameworks and providers resolve *names* (which tenant, which zone, which identity); your data layer enforces *grants*.** Nothing in these deep dives replaces the course's isolation machinery — everything composes with it.
