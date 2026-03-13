#!/bin/sh
set -e

REPO="lnmunhoz/learnthai-web"
BRANCH="main"
INSTALL_DIR="$HOME/.mongocop-cli"

echo "Installing mongocop..."

# Check prerequisites
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node is required but not installed. Install Node.js first: https://nodejs.org"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm is required but not installed."
  exit 1
fi

# Clean previous install
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download and extract only tools/mongocop/ from the repo tarball
TARBALL_URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.tar.gz"
echo "Downloading from $TARBALL_URL..."
curl -fsSL "$TARBALL_URL" | tar -xz --strip-components=2 -C "$INSTALL_DIR" "learnthai-web-$BRANCH/tools/mongocop"

# Install dependencies and build
cd "$INSTALL_DIR"
npm install --ignore-scripts
npm run build
npm prune --production

# Determine bin directory
BIN_DIR="/usr/local/bin"
if [ ! -w "$BIN_DIR" ]; then
  BIN_DIR="$HOME/.local/bin"
  mkdir -p "$BIN_DIR"
fi

# Create symlink
ln -sf "$INSTALL_DIR/dist/index.js" "$BIN_DIR/mongocop"
chmod +x "$INSTALL_DIR/dist/index.js"

# Check if bin dir is in PATH
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *)
    echo ""
    echo "Warning: $BIN_DIR is not in your PATH."
    echo "Add it by running:"
    echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc"
    echo "  source ~/.bashrc"
    ;;
esac

echo ""
echo "mongocop installed successfully!"
echo "Run 'mongocop' to get started."
echo ""
echo "To uninstall:"
echo "  rm -rf ~/.mongocop-cli && rm $BIN_DIR/mongocop"
