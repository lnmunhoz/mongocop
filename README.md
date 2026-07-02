<p align="center">
  <img src="./assets/icon-1777616822637-3.png" alt="mongocop logo" width="160">
</p>

<h1 align="center">mongocop</h1>

<p align="center">Interactive CLI tool for copying MongoDB databases.</p>

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/lnmunhoz/mongocop/main/install.sh | sh
```

Requires Node.js 18+.

## Usage

```sh
mongocop
```

Check the installed version:

```sh
mongocop --version
```

Features:
- Copy entire databases or selected collections
- Copy on the same host or across different hosts
- Pick an existing target database or create a new one
- Save, rename, and delete named connections
- Save, rename, delete, and rerun copy templates
- Stores saved connection secrets in macOS Keychain
- Keeps only non-secret connection metadata in `~/.mongocop/config.json`
- Supports `MONGODB_URL` environment variable (takes priority over saved hosts)
- Copies indexes along with documents
- Overwrite confirmation before dropping existing data
- Collection-level progress indicator

## Development

```sh
pnpm install
pnpm start
```

## Build

```sh
pnpm run build
node dist/index.js
```

## Uninstall

```sh
rm -rf ~/.mongocop && rm /usr/local/bin/mongocop
```

To remove saved secrets from Keychain, open Keychain Access and delete items
created by `mongocop`.
