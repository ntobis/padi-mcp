# Contributing

Thanks for your interest. A few things to know before you open a PR.

## License of your contributions (please read)

This project is **dual-licensed**: released publicly under AGPL-3.0-or-later,
while the copyright holder retains the right to offer it under separate
commercial terms (see `NOTICE`). For that to remain possible, contributions must
not encumber the project's ability to relicense.

By submitting a contribution (a pull request, patch, or any other work) you
agree that:

1. **You wrote it / have the right to submit it.** The contribution is your
   original work, or you have sufficient rights to submit it under these terms
   (this is the [Developer Certificate of Origin](https://developercertificate.org/)).
2. **You grant a broad license to the copyright holder.** You grant Nicolas
   Tobis a perpetual, worldwide, non-exclusive, royalty-free, irrevocable
   license to use, reproduce, modify, distribute, and **sublicense and
   relicense** your contribution as part of this project — *including under
   proprietary or commercial terms* — in addition to the AGPL.

This is what lets the project stay open source **and** be offered commercially
or acquired without chasing down every past contributor. For substantial
contributions a signed Contributor License Agreement may be requested. If you
are contributing on behalf of an employer, make sure you have authority to grant
the above.

If you are not comfortable with this, please open an issue to discuss before
sending code.

## Scope

This repo automates access to a user's **own** PADI account. Please don't submit
changes that target other people's data, evade rate limits or security controls,
or otherwise push the project further from "a user operating their own account."

## Dev basics

```bash
npm install
npm run build
npm test
npm run typecheck
```

See `README.md` for the local server and `apps/managed/` for the hosted service.
