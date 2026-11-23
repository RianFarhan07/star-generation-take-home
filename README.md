# Star Generation: Group Class Enrollment & Billing

A web app for group classes where one tutor teaches several students. Students buy a package of lesson
hours and pay before they get access; tutors write a monthly logbook and are paid for the lessons they
teach; admins create classes, verify payments, review logbooks and see hours, invoices and profit at a glance.

Three role-based views (admin, tutor, student) on Next.js, TypeScript, Tailwind CSS and Supabase
(Auth + PostgreSQL). Payments are simulated: students report a bank transfer and the admin verifies it.
There is no payment gateway.

Read next: [ARCHITECTURE.md](ARCHITECTURE.md) (data model, where each rule is enforced, design system) and
[DECISIONS.md](DECISIONS.md) (the five open decisions, the improvements and what comes next).

## Set up from a fresh clone

You need **Node.js 20+** and **Docker Desktop (running)**. Supabase runs locally in Docker, so no account is needed.

```bash
git clone <repository-url>
cd <repository-folder>
npm ci
npx supabase start          # first run downloads the images and takes a few minutes
npx supabase status -o env  # prints the keys used in the next step
cp .env.example .env.local  # PowerShell: Copy-Item .env.example .env.local
npm run db:reset            # applies supabase/migrations and supabase/seed.sql
npm run dev                 # http://localhost:3000
```

In `.env.local`, set the two keys from the `supabase status` output:

| `.env.local` variable | value from `npx supabase status -o env` |
|---|---|
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` (newer CLIs may call it `PUBLISHABLE_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY` (newer CLIs may call it `SECRET_KEY`) |

`NEXT_PUBLIC_SUPABASE_URL` is already `http://127.0.0.1:54321`. The service role key is used **only by the
test suite**; the app itself always runs with the signed-in user's own session.

`npm run db:reset` returns the database to the demo state described below. Run it whenever you want to start over.

## Seeded logins

No sign-up flow. All accounts use the password **`Password123!`**.

| Role | Name | Email | State in the demo data |
|---|---|---|---|
| Admin | Admin | `admin@example.com` | |
| Tutor | Andi Pratama | `tutor.andi@example.com` | Teaches "Math Grade 8 — Group A" |
| Tutor | Dewi Lestari | `tutor.dewi@example.com` | No class yet (empty states) |
| Student | Budi Santoso | `student.budi@example.com` | Paid, 1.5 hours left, renewal invoice waiting |
| Student | Sari Wulandari | `student.sari@example.com` | Not enrolled |
| Student | Citra Maharani | `student.citra@example.com` | Not enrolled |

The class has **capacity 2**, a 12 hour package, Rp150,000 per student hour and Rp100,000 per tutor hour.
The demo history is generated relative to the moment of the reset, so it is coherent on any day.

The sign-in page lists these accounts when `NEXT_PUBLIC_SHOW_DEMO_LOGINS=true` (set in `.env.example`).
Leave it off, and change the seeded passwords, for anything that is deployed.

## A 10 minute walkthrough

1. **Admin approves a logbook.** Sign in as the admin → *Logbooks* → open the submitted month. Four lessons of
   90 minutes at Rp100,000 per hour preview as **Rp600,000**. Approve it. Approve again: nothing is added.
2. **Tutor finishes a month.** Sign in as Andi → *Logbooks* → open last month: one lesson is missing its entry.
   Write it, then *Finalise and submit*. Back as the admin you can request changes (with a comment and
   flagged entries) or fix a typo yourself; the tutor's original text is kept.
3. **Capacity and payment.** Sign in as Sari → *Browse classes* → enroll (accepting the no-refund note). The seat is
   locked at once and an invoice with a 24 hour countdown appears. Press *I have paid* and fill the form
   (a proof image is optional). Now sign in as Citra: the class is **full**.
4. **Verify.** As the admin, *Overview* shows Sari's transfer under *Needs attention*. Open it and verify it;
   Sari now sees the schedule, her hours and approved logbooks. (Reject it instead to see the seat released.)
5. **Hours running out.** Sign in as Budi: *Low hours* and a renewal invoice. The admin *Overview* lists him too.
   His class page opens with *What's next* from the last approved logbook.
6. **Waitlist and notifications.** As Citra (class full) press *Join waitlist*. As the admin, reject Sari's transfer
   (or let her 24 hours run out): Citra's bell shows that a seat is **reserved for her for 24 hours**, and
   nobody else can enroll into it. Every role has a *Notifications* page (invoices, payment decisions, cancelled
   lessons, logbook updates). Tutors can also schedule a lesson with *Repeat weekly for 8 weeks*.
7. **Money.** Admin → *Classes* → open the class for **profitability** (revenue counted from hours actually used,
   tutor cost, margin, break-even head count). As Andi, *Earnings* answers "what will I be paid?" per lesson.
8. **Things that must not work.** As a student, open `/admin` (you are sent back to `/student`). Rates are never
   visible to tutors, and a student cannot read a logbook that is not approved, even through the API.

## Tests

```bash
npm run test:unit   # fast, no database: time, money, routing, status and error helpers
npm test            # everything: needs `npx supabase start` and a fresh `npm run db:reset`
```

The integration tests sign in as real users against the local Supabase and call the real REST/RPC API, so
they prove the rules hold **through the API**, not only through the screens. They create their own users and
classes and never change the six seeded accounts. They do leave extra rows behind: run `npm run db:reset`
afterwards to get the clean demo data back.

## Scheduled jobs

A `pg_cron` job (`scheduled-jobs`, every 5 minutes) runs `run_scheduled_jobs()`: it expires enrollments whose
24 hour payment window passed without a transfer report, issues renewal invoices when 3 hours or less are
left, and releases the seat of a student who has not renewed 7 days after the first lesson they could not
attend for lack of hours. The tests call the same function with a simulated clock.

## Project layout

```
supabase/migrations/   schema, constraints, triggers, RLS policies and every business rule as SQL functions
supabase/seed.sql      seeded logins, the class and demo history
src/app/{admin,tutor,student}/   the three role areas (pages and server actions)
src/components/ui/     themed component kit (buttons, cards, tables, badges, forms, dialogs)
src/lib/               time (WIB), money (rupiah), routing, status badges, error messages, Supabase clients
tests/                 unit tests and API-level integration tests
```

## Troubleshooting

- **Windows:** run `npm` commands from a terminal whose current folder starts with an **upper-case** drive letter
  (`C:\...`); some terminals report `c:\...`, which breaks the test runner.
- **A test run ends with "Worker exited unexpectedly" (or without a summary):** on Windows with Node 24 the test
  runner's child process occasionally dies on its own, losing a few tests of one file. It is not an assertion
  failure; run `npm test` again. Every other run passes in full.
- **Supabase will not start:** make sure Docker Desktop is running, then `npx supabase stop` and start again.
- **Ports:** the local stack uses 54321 (API), 54322 (database) and 54323 (Studio).
