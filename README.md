This is a production-grade authentication workflow built with [Next.js 16](https://nextjs.org), [Prisma](https://www.prisma.io), and SQLite.

## Documentation & Architecture
For in-depth architectural decisions, security rationales, database configuration, and scaling considerations, see:
- [System Documentation (`DOCUMENTATION.md`)](file:///c:/Users/VOICER%20Admin/Desktop/Auth.%20workflow/DOCUMENTATION.md)

## Getting Started

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Push the SQLite database schema:
```bash
npm run db:push
```

3. Run the development server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

