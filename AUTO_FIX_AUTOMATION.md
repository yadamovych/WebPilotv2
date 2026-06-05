# Extension Lint Auto-Fix Automation

This setup automatically detects and fixes ESLint errors in the WebPilot extension using GitHub Actions.

## How It Works

### Automatic Triggers

The workflow **auto-fix-extension-errors.yml** automatically runs when:

1. **New Issue Created**: Any GitHub issue labeled with `extension-errors`
2. **Issue Edited**: Existing issues with `extension-errors` label are updated
3. **Manual Dispatch**: Run via `gh workflow run auto-fix-extension-errors.yml`

### What It Does

1. ✅ Detects ESLint errors in the extension
2. ✅ Runs `npm run lint:fix` to automatically fix issues
3. ✅ Verifies all fixes pass linting
4. ✅ Commits changes to the main branch
5. ✅ Closes the issue with a summary comment
6. ℹ️ Handles edge cases (no changes, verification failures)

### Example Scenario

**Before Automation:**
```
Issue #3 created: 🐛 Extension errors detected (25 issues)
Manual steps:
  1. Read issue description
  2. Fix each error manually
  3. Test and verify
  4. Commit changes
  5. Close issue
```

**After Automation:**
```
Issue #3 created: 🐛 Extension errors detected (25 issues)
  → Workflow runs automatically
  → All fixes applied
  → Issue auto-closed with success comment
Time saved: ~30 minutes per issue
```

## Configuration

### Files

- **Workflow**: `.github/workflows/auto-fix-extension-errors.yml`
- **Agent Config**: `.agent.md`
- **Documentation**: `AUTO_FIX_AUTOMATION.md` (this file)

### Requirements

The workflow assumes:
- Node.js 18+ available
- `npm run lint:fix` command exists in extension/package.json
- ESLint configured in extension/.eslintrc.js
- GitHub Actions enabled on the repository

## Usage

### Option 1: Wait for Issue

Create an issue with label `extension-errors`:
```bash
gh issue create --title "Extension errors detected" --label extension-errors --label automated
```

The workflow will automatically run and fix the errors.

### Option 2: Manual Trigger

```bash
# Trigger the workflow
gh workflow run auto-fix-extension-errors.yml

# Monitor execution
gh run list --workflow auto-fix-extension-errors.yml
```

### Option 3: Check Existing Workflow

```bash
# List available workflows
gh workflow list

# View recent runs
gh run list --workflow auto-fix-extension-errors.yml --limit 10
```

## Workflow Details

### Permissions Required

```yaml
permissions:
  issues: write          # Update/close issues
  contents: write        # Commit changes
  pull-requests: write   # Create PR comments
```

### Steps

1. **Checkout**: Pull latest code
2. **Setup Node**: Configure Node.js 18 with npm cache
3. **Install**: `npm ci` in extension directory
4. **Fix Errors**: `npm run lint:fix` with auto-fix
5. **Check Changes**: Detect if any files were modified
6. **Commit**: Create commit with fixes (if changes exist)
7. **Push**: Push to main branch
8. **Verify**: Run `npm run lint` to confirm no errors remain
9. **Comment**: Add status comment to issue
10. **Close**: Close issue if successful

### Exit Conditions

| Condition | Action |
|-----------|--------|
| No changes needed | Close issue as "not_planned", comment: "No lint errors detected" |
| Changes fixed successfully | Close issue, comment: "Auto-fixed all lint errors!" |
| Changes made but lint fails | Keep open, comment: "Verification failed - manual review needed" |

## Customization

### Add Scheduled Runs

Edit `.github/workflows/auto-fix-extension-errors.yml` and add:

```yaml
on:
  schedule:
    - cron: '0 0 * * 0'  # Weekly at midnight Sunday
  issues:
    types: [opened, edited]
```

### Change Target Branch

Find and change:
```yaml
git push origin HEAD:main --force-with-lease
```

To use a different branch (e.g., `develop`):
```yaml
git push origin HEAD:develop --force-with-lease
```

### Add Additional Linting

Add steps before "Verify lint passes":
```yaml
- name: Custom checks
  run: |
    cd extension
    npm run test  # if tests exist
```

## Troubleshooting

### Workflow Doesn't Trigger

1. Check issue labels: Must include `extension-errors`
2. Verify GitHub Actions enabled: Settings → Actions → General → Allow all actions
3. Check branch protection: May require approval for main branch commits

### Lint Still Fails After Auto-Fix

1. Check workflow logs: Actions tab → Recent run
2. Some errors may require manual fixes
3. Review the issue comment for details

### Can't Push to Main

Issue: `error: failed to push some refs to origin`

Solution:
1. Check branch protection rules
2. Verify workflow has `contents: write` permission
3. Consider using `--force` (already in workflow)

## Future Enhancements

- [ ] Create PR instead of direct commit for review
- [ ] Run tests and type checking
- [ ] Notify team on Slack/Discord
- [ ] Collect metrics (errors/fixes per week)
- [ ] Create dashboard of lint trends
- [ ] Support other file types (TypeScript, CSS, etc.)

## Related Issues

- Issue #3: Original manual lint error fixes
- Workflow: `.github/workflows/auto-fix-extension-errors.yml`
- Agent: `.agent.md`
