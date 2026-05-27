# Security Policy

This project handles credentials for your PADI account, so security reports are
taken seriously and welcomed.

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via one of:

- GitHub's [private vulnerability reporting](https://github.com/ntobis/padi-mcp/security/advisories/new)
  (Security → Report a vulnerability), or
- email **nicolas.tobis@me.com** with the details.

Please include:

- a description of the issue and its impact,
- steps to reproduce (proof-of-concept if possible),
- affected version / commit, and
- any suggested remediation.

You'll get an acknowledgement as soon as possible (best-effort for a hobby
project), a fix or mitigation plan, and credit if you'd like it.

## Scope & good-faith

In scope: the code in this repository (local server, `@padi-mcp/core`, and the
managed service in `apps/managed`) — especially anything touching credential
handling, token storage/encryption, tenant isolation, or the auth flow.

Out of scope: PADI's own systems and APIs. Please **do not** test against PADI's
infrastructure, other users' accounts, or perform anything beyond your own
account. Responsible, good-faith research on your own setup only.

## What this project already does

- The PADI password is never stored unless you explicitly opt in (`--remember`),
  in which case it goes to the OS keychain or an AES-256-GCM-encrypted file.
- In the managed service, the refresh token is envelope-encrypted at rest and the
  tenant is keyed to the authenticated identity (never to tool arguments).
