# Installing X-Router (private)

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
