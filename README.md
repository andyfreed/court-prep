Custody Case Assistant built with Next.js, Tailwind, shadcn/ui, Prisma, and OpenAI Responses API.

## Workflow (prod-only)

- Make changes with this CLI.
- Commit and push to `main`.
- Vercel builds and deploys production automatically.

## Deployment (Vercel)

- Connect the GitHub repo in Vercel.
- Set the env vars above in Vercel.
- Vercel auto-deploys `main` to production only.

## Environment variables (Vercel)

```
DATABASE_URL=postgres://...
OPENAI_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
NEXTAUTH_URL=https://your-vercel-domain
NEXTAUTH_SECRET=...
APP_USERNAME=...
APP_PASSWORD=...
```

## Notes

- Postgres: use Vercel Postgres or Neon and set `DATABASE_URL`.
- Storage: Vercel Blob via `BLOB_READ_WRITE_TOKEN`.
- Auth: single-user credentials via `APP_USERNAME` / `APP_PASSWORD`.
- OpenAI: Responses API with file_search (vector store per case).
