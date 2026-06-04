#!/bin/bash
# WebPilot Extension Error Handling Setup Script
# This script initializes the error handling system for the extension

set -e

echo "🚀 WebPilot Extension Error Handling Setup"
echo "=========================================="

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 20+"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Install ESLint
cd extension
echo ""
echo "📦 Installing ESLint and dependencies..."
npm install

# Run linting
echo ""
echo "🔍 Running ESLint check..."
npm run lint || {
    echo "⚠️  Linting found issues. Running auto-fix..."
    npm run lint:fix || true
}

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Review changes in extension files"
echo "2. Test extension in Chrome (chrome://extensions/)"
echo "3. Push to GitHub to trigger workflows"
echo "4. Monitor GitHub Issues for extension-errors label"
echo ""
echo "For more information, see: extension/ERROR-HANDLING-README.md"
