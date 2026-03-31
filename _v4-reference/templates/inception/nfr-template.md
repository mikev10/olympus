# NFR Template

Use this template when creating the non-functional requirements document during Requirements Analysis.

**Output path**: `aidlc-docs/{intent-id}/inception/requirements/nfr.md`

This captures **non-functional requirements** (performance, security, accessibility, etc.) for the intent. For brownfield work, many sections will reference existing application standards rather than defining new ones. Keep sections concise -- this is a checklist of standards to meet, not a design document.

---

## Frontmatter

```yaml
---
type: nfr
intent: "{intent-id}"
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `nfr` |
| `intent` | string | YES | Parent intent identifier |
| `status` | string | YES | `draft` on creation, `ready` when approved by Tech Lead |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# Non-Functional Requirements: {Intent Name}

<!-- For brownfield work, many sections will simply reference existing application standards. That is expected and correct -- don't invent new standards when the application already has them. Use "Follow existing application standards" where appropriate, but be specific about any DEVIATIONS or ADDITIONS this intent requires. -->

## Performance

<!-- Response time, throughput, and resource usage targets. Be specific where this intent has different needs than existing pages. -->

| Requirement | Metric | Target |
|-------------|--------|--------|
| {e.g., Page initial load} | Time to interactive | {e.g., < 2s} |
| {e.g., API response time} | p95 latency | {e.g., < 500ms} |
| {e.g., List page with 10k records} | Render time | {e.g., < 1s with virtual scroll} |

{Additional notes or "Follow existing application performance standards."}

## Security

<!-- Authentication, authorization, data protection. For brownfield, reference the existing auth model and note any additions. -->

- **Authentication:** {e.g., "Existing SSO/JWT flow -- no changes"}
- **Authorization:** {e.g., "Role-based access per existing permission model. New permission: LocationAdmin required for edit operations."}
- **Data protection:** {e.g., "PII fields encrypted at rest per existing standard"}
- **Input validation:** {e.g., "Server-side validation on all endpoints. Client-side for UX only."}

## Scalability

<!-- Expected load and growth. For brownfield, reference current production metrics where known. -->

- **Current load:** {e.g., "~200 concurrent users, ~50 req/min to affected endpoints"}
- **Expected growth:** {e.g., "No significant change expected" or "3x increase due to new feature adoption"}
- **Scaling approach:** {e.g., "Existing horizontal scaling via load balancer -- no changes needed"}

## Reliability

<!-- Uptime, error handling, data integrity targets. -->

- **Uptime target:** {e.g., "99.9% -- matches existing application SLA"}
- **Error rate tolerance:** {e.g., "< 0.1% of requests"}
- **Data integrity:** {e.g., "Transactional writes for multi-table operations"}
- **Graceful degradation:** {e.g., "Show cached data if downstream service is unavailable"}

## Accessibility

<!-- WCAG compliance level, screen reader support, keyboard navigation. -->

- **WCAG level:** {e.g., "WCAG 2.1 AA"}
- **Screen reader support:** {e.g., "ARIA labels on all interactive elements"}
- **Keyboard navigation:** {e.g., "Full keyboard navigation for all CRUD operations"}
- **Color contrast:** {e.g., "Meets AA contrast ratios per existing design system"}

## Browser/Device Support

<!-- Supported browsers, responsive requirements, mobile considerations. -->

| Browser | Version | Support Level |
|---------|---------|---------------|
| {e.g., Chrome} | {e.g., Latest 2 versions} | Full |
| {e.g., Firefox} | {e.g., Latest 2 versions} | Full |
| {e.g., Safari} | {e.g., Latest 2 versions} | Full |
| {e.g., Edge} | {e.g., Latest 2 versions} | Full |
| {e.g., IE 11} | {e.g., 11} | Not supported |

- **Responsive:** {e.g., "Desktop only -- admin application" or "Responsive down to 768px"}
- **Mobile:** {e.g., "Not required" or "Read-only mobile view required"}

## Compliance

<!-- Regulatory, legal, and data handling requirements. -->

- **Regulatory:** {e.g., "GDPR data handling for EU customers" or "N/A"}
- **Data retention:** {e.g., "Follow existing retention policy -- 7 years for transaction data"}
- **Audit trail:** {e.g., "Log all create/update/delete operations with user and timestamp"}
- **Legal:** {e.g., "Terms of service acceptance required for new registrations" or "N/A"}

## Observability

<!-- Logging, monitoring, alerting requirements. -->

- **Logging:** {e.g., "Structured logging via existing logging framework. Log all API errors with correlation IDs."}
- **Monitoring:** {e.g., "Dashboard for new endpoints -- response time, error rate, throughput"}
- **Alerting:** {e.g., "Alert on error rate > 1% sustained for 5 minutes"}
- **Tracing:** {e.g., "Distributed tracing via existing APM tool" or "N/A"}
```

---

## Quality Checklist

Before marking NFRs as `status: ready`:

- [ ] All 8 sections are present (even if some say "Follow existing standards")
- [ ] Performance targets are specific and measurable
- [ ] Security section addresses auth, authz, data protection, and input validation
- [ ] Accessibility level is explicitly stated
- [ ] Browser support matrix is complete
- [ ] Any deviations from existing standards are clearly called out
- [ ] Compliance requirements are documented or explicitly marked N/A
- [ ] Observability covers logging, monitoring, and alerting
- [ ] Frontmatter fields all populated (no placeholders)
