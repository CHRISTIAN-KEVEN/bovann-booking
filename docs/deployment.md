# Deployment: staging

_Added 2026-11-24._ Staging is a copy of the site the client can open at any time, updated automatically a few minutes after each merge to `main`. Payments and seller sign-in codes are **simulated**; emails are caught by an inbox on the site itself, so no real customer is ever contacted.

## How it works

```
merge to main ─▶ CI (tests + staging stack smoke test) ─▶ "Deploy staging" workflow
                                                              │ builds 2 images, pushes them to ghcr.io
                                                              │ SSH to the server as `deploy`
                                                              ▼
              VPS (Ubuntu 24.04, Docker Compose, /opt/bovann/staging)
              caddy  :443  HTTPS (Let's Encrypt), one password for the whole site, noindex
                ├── /api/*      ─▶ api   (NestJS, DEPLOY_ENV=staging)
                ├── /mailpit/   ─▶ mailpit (every email staging sends)
                └── everything else ─▶ web (Next.js, simulated payment buttons)
              mysql (data volume) · backup (dump every night at 02:00 UTC, 14 kept)
```

- **Images** are tagged with the commit SHA, so every deploy can be traced to a commit and rolled back.
- **`deploy.sh`** pulls the images, starts MySQL, runs the migrations, seeds the reference data **only on the first deploy** (the seed rewrites hours and settings, which would erase the client's changes), starts everything, then waits until `https://<domain>/healthz` answers. It stops at the first error.
- **The smoke test** (`smoke-test.sh`) checks the site from outside: the password is required, pages answer in French and English, the API answers, pages carry `noindex`. In CI it also books a slot, pays by simulation, downloads the receipt, checks the slot can't be booked twice and that the owners' email arrived. After a real deploy it runs read-only, so it leaves no test bookings on the client's staging.
- **Every pull request** builds both images and runs this whole stack in CI (first deploy, booking, second deploy), so a broken Dockerfile, migration or script is caught before it reaches `main`.
- **Secrets** stay on the server (`/opt/bovann/staging/.env`, created by `setup-server.sh` with random values) and in GitHub's encrypted secrets. Nothing secret is in git or in the images.

## One-time setup (about 30 minutes)

You need: a VPS, a domain or subdomain you control, and admin rights on the GitHub repository.

1. **Create the server.** Ubuntu 24.04, 2 vCPU and 4 GB RAM are enough (Hetzner CX22-type, DigitalOcean or Contabo). Add your own SSH key when creating it.
2. **Point the domain to it.** Create an `A` record, for example `staging.your-domain.com` → the server's IP. On Cloudflare, leave the cloud **grey (DNS only)**, so the server can get its HTTPS certificate.
3. **Create the deploy key** on your laptop (it lets GitHub, and only GitHub, deploy):
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/bovann_staging_deploy -C github-deploy -N ""
   ```
4. **Prepare the server** (as root, replace the domain):
   ```bash
   ssh root@<server-ip>
   curl -fsSL https://raw.githubusercontent.com/CHRISTIAN-KEVEN/bovann-booking/main/infra/staging/setup-server.sh -o setup-server.sh
   bash setup-server.sh staging.your-domain.com "<content of ~/.ssh/bovann_staging_deploy.pub>"
   ```
   It prints the **site password once**: save it in your password manager.
5. **Add the GitHub settings** (repository → Settings → Environments → New environment `staging`), or from your laptop with `gh`:
   ```bash
   gh secret set STAGING_HOST --env staging --body "<server-ip>"
   gh secret set STAGING_SSH_KEY --env staging < ~/.ssh/bovann_staging_deploy
   ssh-keyscan -t ed25519 <server-ip> | gh secret set STAGING_KNOWN_HOSTS --env staging
   gh secret set STAGING_PASSWORD --env staging        # paste the site password
   gh variable set STAGING_DOMAIN --env staging --body "staging.your-domain.com"
   ```
   Optional: `STAGING_STUDIO_CONTACT_PHONE` (variable) for the conditions page.
6. **First deploy:** GitHub → Actions → **Deploy staging** → Run workflow. About 10 minutes the first time.
7. **Create the first admin account** on the server:
   ```bash
   cd /opt/bovann/staging
   docker compose --env-file .env --env-file release.env run --rm api \
     node dist/admin/create-admin.js --email <their email> --name "<their name>"
   ```
   It prints a temporary password, changed at first sign-in.
8. **Share with the client:** the address, then **separately** the site user (`bovann`) and password, and their admin sign-in.

## Everyday operations

| Need                   | How                                                                                                                                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deploy                 | Merge a PR into `main`. Progress: GitHub → Actions → Deploy staging.                                                                                                                                                                                  |
| See emails sent        | `https://<domain>/mailpit/`                                                                                                                                                                                                                           |
| Roll back              | Actions → Deploy staging → Run workflow, with the SHA of the previous deploy (shown in each run's summary). Migrations are not undone, so a migration must keep working with the previous version of the code (add first, remove in a later release). |
| Logs                   | `cd /opt/bovann/staging && docker compose --env-file .env --env-file release.env logs -f api`                                                                                                                                                         |
| Restore a backup       | `docker compose … exec backup ls /backups`, then `gunzip -c <file> \| docker compose … exec -T mysql sh -c 'mysql -ubovann -p"$MYSQL_PASSWORD" bovann'`                                                                                               |
| Reset staging to empty | `docker compose … down -v` (deletes all data), then redeploy.                                                                                                                                                                                         |

## Not done yet (before production)

- **Off-site backups:** dumps stay on the server for now; copy them to object storage (e.g. Backblaze B2 or S3) before real data matters.
- **Uptime alerts:** point a free monitor (UptimeRobot, Better Stack) at `https://<domain>/healthz`.
- **Production** reuses this setup with `DEPLOY_ENV=production`: no simulated payments or codes (the API refuses to start with them), a real payment provider, real emails, no site password, its own server or at least its own database.
