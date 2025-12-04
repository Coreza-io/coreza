# Coreza Feature Comparison

| Area | Open Source (AGPL-3.0) | Commercial License |
| --- | --- | --- |
| Visual workflow builder | Core automation canvas, node editor, scheduling | Advanced templates, change management, SLAs |
| Broker integrations | Alpaca, Dhan connectors, credential vault | Certified integrations, expedited broker onboarding |
| Market data | Real-time feeds with core indicators | Premium data packs, extended retention |
| Access control | Role-based permissions, JWT auth | SSO/SAML/SCIM, audit-grade access logs |
| Logging & audit | Basic event logging, security alerts | Extended retention, export pipelines, compliance packs |
| Theming | Standard UI themes | White-label theming, custom branding |
| Support | Community forums & GitHub Discussions | Dedicated support, onboarding, training |
| Compliance | Open telemetry hooks | Enterprise compliance reports and attestations |

## Notes on Licensing
- The open source edition follows **GNU AGPL-3.0**; networked modifications must remain open.
- Commercial licensing permits closed-source extensions, redistribution rights, and enterprise support.
- Refer to [COMMERCIAL_LICENSE.md](../COMMERCIAL_LICENSE.md) for terms.

## Feature Gate Recommendations
- Use environment variables or feature flags to toggle commercial-only features.
- Clearly label premium routes and UI components to avoid accidental exposure.
- Document any deviations in deployment runbooks or change logs.
