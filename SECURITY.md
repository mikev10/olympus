# Security policy

## Supported versions

Only the `v2` branch is maintained. `main` holds v1, which is frozen and receives no fixes.

| Branch | Supported |
|---|---|
| `v2` | Yes |
| `main` (v1) | No |

## Reporting a vulnerability

Do not open a public issue for a vulnerability.

Report it privately through GitHub: on the repository's **Security** tab, choose **Report a vulnerability**. Only the repository's maintainers and admins can see the report.

Please include:

- what an attacker can do, and what they need to already have to do it;
- the file and line on `v2` where the behaviour lives, if known;
- steps or a test that shows it.

Reports that a control can be bypassed are especially welcome: an agent writing to the Vault, a check that passes when it should refuse, an artifact an agent can write being used to judge that agent, or an event payload reaching a prompt.

You will get a reply within 7 days. Once a fix is merged, the advisory is published with credit to you, unless you ask not to be named.
