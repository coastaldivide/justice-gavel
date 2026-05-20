# GitHub Actions CI Setup

## What runs on every push/PR

| Job | Trigger | Blocks merge |
|-----|---------|-------------|
| Backend Tests (88) | All pushes | Yes |
| Frontend Tests (222) | All pushes | Yes |
| TypeScript Check | All pushes | No (non-blocking) |
| Security Audit | All pushes | No |
| EAS Preview Build | `main` / `staging` only | No |

## Required secrets (Settings → Secrets → Actions)

| Secret | How to get it |
|--------|---------------|
| `EXPO_TOKEN` | expo.dev → Account → Access Tokens |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |

## Branch protection rules (Settings → Branches → main)

Enable:
- ✅ Require status checks to pass before merging
  - Required: `Backend Tests (Node 22)`
  - Required: `Frontend Tests (Node 22)`
- ✅ Require branches to be up to date before merging
- ✅ Restrict pushes that create matching branches

## Local test commands

```bash
# Backend
cd backend
NODE_OPTIONS="--experimental-vm-modules" npx jest --config jest.config.js --no-coverage

# Frontend
cd frontend
npx jest --config jest.frontend.config.js --no-coverage
```
