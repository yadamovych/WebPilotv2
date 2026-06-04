# WebPilot Extension Error Handling System

## Overview

This system provides comprehensive error handling, tracking, and automated GitHub issue creation for the WebPilot Chrome extension. It prevents silent failures and ensures errors are caught, logged, and reported for fixing.

## Components

### 1. **error-handler.js** - Runtime Error Tracking

Central error management utility loaded in the extension.

#### Key Features:
- **ErrorTracker Class**: Maintains error log with automatic memory management
- **Safe Wrappers**: Protect chrome API calls and messaging
- **Persistent Storage**: Errors saved to `chrome.storage.local`
- **Export/Reporting**: Generate error reports for backend submission

#### Usage:

```javascript
// Track an error
errorTracker.track(new Error('Something went wrong'), {
  context: 'recording',
  severity: 'high'
});

// Safe chrome API calls
safeChrome(() => {
  return chrome.storage.session.get(['key']);
});

// Safe messaging with timeout
const response = await sendMessageSafe({
  type: 'EXECUTE_TEMPLATE',
  data: template
}, { timeout: 5000, fallback: {} });

// Safe storage
await safeStor.set({ lastAction: Date.now() });

// Export errors for reporting
const report = await errorTracker.exportErrors();
```

### 2. **CI Pipeline (ci.yml)** - Automated Testing

Enhanced CI workflow that catches extension errors on every PR/push.

#### Extension Checks:
- **ESLint Linting**: Catches syntax and style issues
- **Security Scan**: Detects eval(), localStorage, hardcoded credentials
- **Build Verification**: Validates extension structure
- **Artifact Upload**: Stores reports for 30 days

#### How It Works:
1. Node.js 20 installed
2. Dependencies from `package.json` installed
3. ESLint runs with JSON output
4. Security patterns checked
5. Lint report uploaded as artifact
6. **Job fails if errors found** (prevents merge)

### 3. **Scheduled Error Checker (extension-error-checker.yml)**

Runs every 6 hours to detect and report extension errors.

#### Features:
- **Pattern Detection**: Finds unhandled promises, missing error handlers, debug statements
- **ESLint Integration**: Comprehensive code quality checks
- **Automatic Issue Creation**: Creates GitHub issue for errors found
- **Issue Deduplication**: Updates existing issue instead of creating duplicates
- **Manual Trigger**: Can be run on-demand with severity filter

#### Issue Format:
```markdown
🐛 Extension errors detected (42 issues)

## Lint Errors

### background.js
- Line 45: 'STATE' is assigned but never used
- Line 112: Missing semicolon

### content.js
- Line 23: Expected '===' but got '=='
```

### 4. **ESLint Configuration (.eslintrc.json)**

Predefined rules for WebPilot extension code quality.

#### Key Rules:
- `no-unused-vars`: Warns on unused variables
- `eqeqeq`: Requires `===` instead of `==`
- `curly`: Always use braces in control structures
- `semi`: Always require semicolons
- `no-var`: Prefer `const`/`let` over `var`

#### Allow Chrome Globals:
```json
"globals": {
  "chrome": "readonly",
  "errorTracker": "writable",
  "safeStor": "writable"
}
```

## Integration Guide

### Step 1: Include Error Handler in HTML

Add to `popup.html`, `sidepanel.html`:
```html
<script src="error-handler.js"></script>
<script src="popup.js"></script>
```

Or in `manifest.json` for background scripts:
```json
"background": {
  "service_worker": "error-handler.js"
  // Then background.js includes error-handler via web_accessible_resources
}
```

### Step 2: Replace Direct Chrome Calls

**Before:**
```javascript
chrome.storage.session.set({key: value});
chrome.runtime.sendMessage({type: 'MSG'}, callback);
```

**After:**
```javascript
await safeStor.set({key: value});
const response = await sendMessageSafe({type: 'MSG'}, {timeout: 5000});
```

### Step 3: Wrap Custom Operations

```javascript
try {
  const result = await someAsyncOperation();
} catch (error) {
  errorTracker.track(error, {
    operation: 'someAsyncOperation',
    context: 'user-action'
  });
  // Handle gracefully
}
```

### Step 4: Optional - Report to Backend

```javascript
// Periodically send errors to backend
setInterval(async () => {
  const result = await reportErrorsToBackend('https://api.webpilot.local/errors');
  if (result.success) {
    console.log('Errors reported to backend');
  }
}, 3600000); // Every hour
```

## Workflow Triggers

### On Pull Request
```
Trigger: PR to main/develop
Result: ESLint runs, security checks, artifacts uploaded, job fails if errors
```

### Scheduled Check
```
Trigger: Every 6 hours (0 */6 * * *)
Result: Full analysis, pattern detection, GitHub issue created/updated
```

### Manual Trigger
```
Trigger: GitHub Actions > extension-error-checker.yml > Run workflow
Options: Choose severity filter (all, critical, high, medium)
Result: Custom error check with issue creation
```

## Monitoring & Analysis

### GitHub Issues
- Label: `extension-errors`
- Status: Auto-updated every 6 hours
- View trends: Issues > Labels > extension-errors

### Artifacts
- Available in Actions > Workflow run > Artifacts
- `extension-lint-report` JSON file
- Retained for 30 days
- Contains detailed error information

### Error Storage
- Runtime errors stored in `chrome.storage.local`
- Maximum 100 errors per session
- Accessible via `errorTracker.getErrors()`
- Can be exported via `errorTracker.exportErrors()`

## Example Error Report

```json
{
  "exportDate": "2025-06-04T12:30:00Z",
  "extensionVersion": "1.0.0",
  "errorCount": 5,
  "errors": [
    {
      "timestamp": "2025-06-04T12:15:30Z",
      "message": "Failed to send message to content script",
      "stack": "Error: Extension context invalidated\n    at safeSend (popup.js:45:12)",
      "context": {
        "operation": "chrome-api",
        "type": "message-error"
      },
      "url": "chrome-extension://...",
      "type": "Error"
    }
  ]
}
```

## Best Practices

1. **Use Safe Wrappers**: Never call chrome APIs directly; always use `safeChrome()` or `safeStor`
2. **Handle Timeouts**: Messaging can fail; use `sendMessageSafe()` with appropriate timeouts
3. **Track Context**: Provide meaningful context when tracking errors
4. **Test Locally**: Run `npm run lint` and `npm run lint:fix` before pushing
5. **Review Issues**: Check automatically created issues and fix errors promptly

## Troubleshooting

### ESLint Not Running
- Ensure `package.json` exists in `/extension` directory
- Run `npm install` in extension directory
- Check `.eslintrc.json` exists

### GitHub Issue Not Creating
- Check repo has `issues: write` permission in workflow
- Verify GitHub token has sufficient permissions
- Check workflow logs for details

### Errors Not Persisting
- Verify `chrome.storage.local` is not disabled
- Check extension permissions in manifest.json
- Ensure error-handler.js is loaded before other scripts

### High Error Count
- Review reported lint rules
- Consider disabling non-critical warnings
- Run `npm run lint:fix` for auto-fixable issues

## Files Reference

| File | Purpose |
|------|---------|
| `extension/error-handler.js` | Runtime error tracking utility |
| `.github/workflows/ci.yml` | Main CI pipeline with extension checks |
| `.github/workflows/extension-error-checker.yml` | Scheduled error detection & issue creation |
| `extension/.eslintrc.json` | ESLint configuration |
| `extension/package.json` | NPM dependencies and scripts |
| `.github/workflows/extension-workflow-config.json` | Complete system documentation |

## Next Steps

1. Review and merge workflows
2. Run `npm install` in extension directory
3. Test locally: `npm run lint`
4. Fix any reported issues with: `npm run lint:fix`
5. Push to trigger CI
6. Monitor GitHub Issues for errors

---

**Created:** 2025-06-04  
**System Version:** 1.0.0  
**Status:** Ready for production
