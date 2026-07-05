# Release Process

This project publishes GitHub Releases with a standalone Bun binary.

## Automatic releases

Pushing to `main` or `master` runs the `Release` workflow. The workflow:

1. Installs dependencies with Bun.
2. Runs tests, typecheck, lint, and the standalone build.
3. Verifies `./dist/ssh-agent --help` works.
4. Reads `package.json` and creates `v<version>` if that release does not already exist.
5. Uploads `dist/ssh-agent` and `dist/ssh-agent.sha256`.

The workflow uses the built-in `GITHUB_TOKEN`; no extra repository secret is required.

If the release for the current package version already exists, the workflow skips release creation. Bump `package.json` before publishing another release.

## Manual release

Use `workflow_dispatch` from the GitHub Actions page when you need to retry a release for the current commit.

To create the release locally instead, run:

```bash
bun install --frozen-lockfile
bun test
bun run typecheck
bun run lint
bun run build:standalone
./dist/ssh-agent --help
sha256sum dist/ssh-agent > dist/ssh-agent.sha256
gh release create "v$(node -p "require('./package.json').version")" \
  dist/ssh-agent \
  dist/ssh-agent.sha256 \
  --title "v$(node -p "require('./package.json').version")" \
  --generate-notes
```
