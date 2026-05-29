# X-Router — Install & Maintain

This file has two parts:

- **[For Users](#for-users)** — install and update X-Router on your machine (you
  received a GitHub invite from the admin).
- **[For the Admin](#for-the-admin-maintainer)** — build, release new versions,
  and manage who has access.

---

# For Users

X-Router is distributed privately via **GitHub Packages**. You need a GitHub
account that has been granted access to the `daokimluc/X-Router` repository, plus
a personal access token. Works the same on **Windows** and **macOS**.

## 1. Create a GitHub token (one time)

1. Go to <https://github.com/settings/tokens/new> (Personal Access Token — classic)
2. Note: `x-router install`, pick an expiration
3. Select scopes:
   - `read:packages`
   - `repo` (the repository is private)
4. **Generate token** and copy it (starts with `ghp_`). It is shown only once.

> **Use a _classic_ token, not a fine-grained one.** GitHub Packages' npm
> registry does not accept fine-grained tokens yet — they fail with
> `403 ... token does not match expected scopes`. The link above already opens
> the classic token page.

## 2. Tell npm to use the token (one time, per machine)

Run this once, replacing `YOUR_TOKEN` with the token from step 1:

```bash
npm config set //npm.pkg.github.com/:_authToken=YOUR_TOKEN
npm config set @daokimluc:registry=https://npm.pkg.github.com
```

> The first line authenticates you to GitHub Packages. The second tells npm that
> any `@daokimluc/*` package comes from GitHub Packages, not the public npm
> registry. Other packages are unaffected.

## 3. Install

```bash
npm install -g @daokimluc/x-router
```

Then run it:

```bash
x-router
```

It opens the dashboard at <http://localhost:3100> and prints the admin login key
in the console (default: `admin`).

## Updating to a new version

Whenever the admin publishes a new version, just run:

```bash
npm install -g @daokimluc/x-router@latest
```

## Where your data lives

- `~/.x-router/config.json` — admin key + saved API keys
- `~/.x-router/gateway-state.json` — accounts, usage, logs, etc.
- `~/.x-router/server.log` — server log

On Windows, `~` is `C:\Users\<you>`. Your data is local to your machine and is
never uploaded anywhere.

## Troubleshooting

- **401 / 403 on install** — token missing, expired, or lacks `read:packages` /
  `repo` scope. Redo step 1–2.
- **404 Not Found** — your GitHub account hasn't been granted access to the
  repository. Ask the admin to add you.
- **`x-router` not found after install** — make sure your global npm bin
  directory is on PATH (`npm bin -g` shows where it is).

---

# For the Admin (maintainer)

You have the full source in `D:\Project\Accountrouter` (or your clone path).
You do **not** need a token or GitHub Packages to run it locally — only to
publish releases for other users.

## Run / update your own machine

Your machine builds from source, so you never download from GitHub Packages.
After editing code, rebuild and reinstall your global `x-router` with one
command:

```bash
cd D:\Project\Accountrouter
npm run deploy:local
```

`deploy:local` runs `npm run build:all && npm i -g .` — it builds the dashboard
and gateway, then installs the global CLI from this folder (the `.`). Then:

```bash
x-router
```

## One-time setup to publish (GitHub Packages auth)

Publishing pushes to the private GitHub Packages registry. Authenticate once
with a **classic** token that has `write:packages` + `repo` scopes
(<https://github.com/settings/tokens/new>):

```bash
npm config set //npm.pkg.github.com/:_authToken=YOUR_ADMIN_TOKEN
```

`package.json` already sets `publishConfig.registry` to
`https://npm.pkg.github.com`, so `npm publish` goes to GitHub Packages, never
the public npm registry.

## Release a new version

```bash
# 1. bump the version in package.json (e.g. 0.3.3 -> 0.3.4)
# 2. build + publish
npm run build:all
npm publish
# 3. (optional) tag the release
git tag v0.3.4 && git push origin main --tags
```

`prepack` rebuilds automatically on publish, so step 2's build is belt-and-
suspenders. After publishing, tell users to run:

```bash
npm install -g @daokimluc/x-router@latest
```

## Manage who can install

Each user installs with their **own** GitHub token, so access is per-person:

1. Invite their GitHub account to the repo: repo → **Settings → Collaborators →
   Add people**. **Read** permission is enough.
2. Send them this file (the *For Users* section).
3. To revoke someone, remove them from Collaborators — their token can no longer
   read the package.

## Scripts reference

| Command | What it does |
| --- | --- |
| `npm run deploy:local` | Build + install global CLI from local source (admin's own machine) |
| `npm run build:all` | Build dashboard + gateway into `dist/` and `dashboard-dist/` |
| `npm publish` | Publish to private GitHub Packages |
| `x-router --reset-admin-key` | Reset the admin login password back to `admin` |
| `x-router --print-keys` | Print the saved admin key |

## Security notes

- Never commit a token. Tokens live only in `~/.npmrc` (auth) — that file is
  outside the repo.
- The published package contains compiled JS in `dist/` (logic is readable),
  but **no** credentials: `~/.x-router/config.json` and `gateway-state.json`
  stay on each machine and are never bundled.
- GitHub Packages' npm registry rejects fine-grained tokens; use classic tokens.


