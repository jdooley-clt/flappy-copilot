# Security policy

## Supported versions

Only the `main` branch and the live GitHub Pages site built from it,
<https://jdooley-clt.github.io/flappy-copilot/>, receive security fixes.
Forks, older commits, and copies hosted elsewhere are not supported.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub Private Vulnerability
Reporting: <https://github.com/jdooley-clt/flappy-copilot/security/advisories/new>.
Do not open a public issue or pull request for a security problem.

Include what you found, the browser and page where it reproduces, and steps or a
proof of concept. Reports are acknowledged and discussed in the private advisory,
and fixes ship through the normal gated deployment workflow.

## Scope

Flappy Copilot is a static, client-side browser game: `index.html`, `style.css`,
and the scripts in `src/`. There is no server, account system, analytics, or
network request at runtime beyond loading those same-origin files. The only data
the game stores is the local high score, in the browser's `localStorage`.

Relevant reports include script injection or Content Security Policy bypasses,
unsafe handling of the embedding arcade cabinet, and supply-chain problems in the
build or deployment workflow. Issues in GitHub Pages or GitHub Actions themselves
belong with [GitHub's own program](https://github.com/security). The arcade
cabinet that embeds this game is maintained separately in
[jdooley-clt/arcade](https://github.com/jdooley-clt/arcade).
