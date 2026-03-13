# mongocop

Interactive CLI tool for copying MongoDB databases.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/lnmunhoz/learnthai-web/main/tools/mongocop/install.sh | sh
```

Requires Node.js 18+.

## Usage

```sh
mongocop
```

Features:
- Save and reuse connection strings
- Copy databases on the same host or across different hosts
- Collection-level progress indicator
- Interactive prompts for source/target selection

## Development

```sh
cd tools/mongocop
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
rm -rf ~/.mongocop-cli && rm /usr/local/bin/mongocop
```
