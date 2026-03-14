# mongocop

Interactive CLI tool for copying MongoDB databases.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/lnmunhoz/mongocop/main/install.sh | sh
```

Requires Node.js 18+.

## Usage

```sh
mongocop
```

Features:
- Copy entire databases or selected collections
- Copy on the same host or across different hosts
- Pick an existing target database or create a new one
- Save, rename, and delete connection strings
- Supports `MONGODB_URL` environment variable
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
