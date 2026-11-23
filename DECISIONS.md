# Decisions

Numbers used throughout (they are also the seed data): student rate **Rp150,000 per hour**, tutor rate
**Rp100,000 per hour**, lessons of **90 minutes**, a **12 hour package** (= 8 lessons = Rp1,800,000). So one
student's share of one lesson is Rp225,000 and the tutor earns Rp150,000 per lesson.

One idea runs through most answers: **the business only promises what it has been paid for, and a change never
reaches backwards.** A sent invoice keeps its price, a lesson already taught keeps its rate and its tutor, and
nobody who paid loses their seat because of an admin's later decision.

## The five open decisions

### 1. How the invoice is calculated and how hours are counted

**Decision.** Each class has a package size (default 12 hours). The invoice is package hours × the *current*
student rate, and the rate and amount are frozen on the invoice (`amount = hours × rate` is a constraint). The
admin can change the hours of an *unpaid* invoice, for example for a student who joins mid-term; the price per
hour stays, so this is a quantity change, never a hidden discount.

Hours are counted per seat, not per attendance: every lesson that has ended and was not cancelled uses its
duration from every paid student of the class, whether they came or not, counting only lessons after the
student's first payment. Hours come from the oldest paid invoice first, and a lesson is deducted only if the
remaining hours cover all of it, so a balance never goes negative. There is no stored "hours left": it is
replayed from payments and lessons, so cancelling a lesson gives the hours back by itself.

**Considered.**
- *Student chooses 6/12/24 hours.* Rejected: the brief fixes one rate per hour, so a bigger package is not
  cheaper and the choice means nothing; small packages would only create more renewal invoices to chase.
- *Pay monthly afterwards.* Rejected: contradicts "pay before access".
- *Deduct only when the student attended.* Rejected: the tutor is paid Rp150,000 per lesson whoever comes, so
  every empty seat is lost margin; absent students would also keep a seat far longer than they paid for, and
  tutors would have to take attendance.
- *Deduct when the logbook is approved.* Rejected: "hours left" would lag by up to a month, which is exactly
  the problem the admin has today.
- *Excused absences through the app* (24 hours' notice, an automatic rule, a quota of one per 12 paid hours
  counted from paid hours rather than per invoice, the lesson cancelled if everyone is excused). Designed in
  detail and **not adopted**. Each absence moves Rp225,000 of consumption into the future; in the 2-seat
  demo class one excused student cuts that lesson's margin from Rp300,000 to Rp75,000 (−75%), in a 10-seat
  class from Rp2,100,000 to Rp1,875,000 (−11%). It needs about six extra rules (cut-off, quota source, all
  excused, tutor-cancelled, admin exception, cost in the profit report), and the brief does not name absence
  as a problem. Group-class providers I compared mostly give no credit either.
- *Private make-up lessons.* Rejected: the tutor is paid twice (Rp150,000 more) and a group class turns into
  private tuition at group prices.
- *A validity window on packages.* Rejected: in a per-seat model every lesson that runs uses hours, so a
  package ends by itself long before 12 weeks; the window would only bite on lessons the business cancelled,
  which would need automatic extensions. A rule that fights the model.

**When the others are better.** Attendance-based counting suits private lessons; excused absences become worth
it once data shows families leave because they feel they paid for lessons they could not attend, and they are
cheap in large classes. A package discount makes student-chosen sizes meaningful.

**Weak spots.** A sick student still uses the hour; the policy is shown at enrollment and on every invoice.

**Enforced in.** `invoices_amount_matches`; `enroll_in_class`, `adjust_invoice_hours`; `_ledger`,
`enrollment_balance` (`fn_hours`).

### 2. What happens when the admin changes a class's rate, capacity or tutor

**Decision: changes apply forward only.**
- *Student rate:* issued invoices keep their price; the new rate applies to the next invoice.
- *Tutor rate:* `class_rates` is a history table; a lesson is paid at the rate in force when it *started*.
  Lessons before the change keep the old rate even if their logbook is approved later (tested: Rp150,000 before
  the change, Rp120,000 after it for a 90 minute lesson).
- *Capacity:* can go up any time; cannot go below the seats already held (trigger `classes_capacity_check`).
  Nobody is removed silently.
- *Tutor:* `change_class_tutor` moves only lessons that have not started, in one transaction. Taught lessons,
  their entries and earnings stay with the previous tutor. If a moved lesson would overlap the new tutor's own
  lessons the whole change is rejected.

**Considered.** Recalculating unpaid invoices (changes a price already sent); paying the rate in force at
approval (a rate cut would silently reduce pay for lessons already taught); lowering capacity by removing the
last student (breaks a promise to someone who paid); moving all future lessons by cancelling and rescheduling
(destroys students' schedules).

**Weak spots.** A rate change takes effect immediately, not on a chosen future date; there is no notification
to families or tutors. **Enforced in.** `set_class_rates`, `lesson_earning`, `set_class_capacity`,
`change_class_tutor` (`fn_classes`, `fn_earnings`).

### 3. Out of hours, a cancelled lesson, and leaving with hours unused

**3a. A student runs out of hours.** No negative balances and no free lessons. When 3 hours or less are left a
renewal invoice is issued automatically (a lesson that cannot be covered is "Out of hours" for that student: not
deducted, flagged on the tutor's roster, the student still sees past logbooks). If the renewal is still unpaid
7 days after the first lesson missed for lack of hours, the seat is released. A renewal transfer waiting for
the admin pauses this: the admin's delay is not the student's fault. *Considered:* letting the balance go
negative (the business delivers Rp225,000 per lesson before being paid, and may never be), removing the student
at zero hours (too harsh for a family a day late).

**3b. A lesson is cancelled.** The tutor (or admin) cancels with a required reason; the row stays (soft
cancel). It costs students no hours, earns the tutor nothing, needs no entry and frees the slot for the overlap
rule. It is allowed until the month's logbook is submitted. *Considered:* deleting the lesson (students and
audit lose the trace), admin-only cancellation (a bottleneck when a tutor is ill that morning).

**3c. A student leaves, or the class closes, with hours unused.** If the *business* ends it (class closed,
tutor unavailable, admin removes a student who did nothing wrong) the unused hours are refunded at the rate of
the invoices they belong to (10.5 hours × Rp150,000 = Rp1,575,000 in the tests). If the *student* leaves, there
is **no refund**; this is the common practice among Indonesian tutoring providers. The student accepts it
explicitly before enrolling (`terms_accepted_at`), it is repeated on every invoice, the withdraw dialog shows
the hours and rupiah value being given up, and the admin can still issue an exception refund with a recorded
reason.

*Legal note.* Article 18(1)(c) of the Consumer Protection Law (UU 8/1999) restricts standard clauses that let a
business refuse to return money, and such clauses can be void. I kept the market practice with the safeguards
above and would ask for legal review before launch. The fallback I analysed is to require one lesson's notice
and refund the rest pro rata (Budi leaving after 3 lessons would get Rp900,000). *Considered:* full pro-rata
refund (empty seats appear overnight and students can try classes risk-free), a 10% admin fee (a number with no
cost behind it), credit for another class (there is only one class).

**Enforced in.** `run_scheduled_jobs`, `create_renewal_invoice`, `cancel_lesson`, `withdraw_enrollment`,
`create_exception_refund` (`fn_hours`, `fn_lessons`, `fn_lifecycle`).

### 4. What happens when the admin finds a problem in a submitted logbook

**Decision.** Two routes. *Request changes* with a required comment (optionally flagging entries) sends the
logbook back to the tutor, who edits and submits again; every round is kept in `logbook_reviews`. For a small
fix the admin can *edit the four text fields* of an entry while the logbook is submitted; the tutor's original
text is saved in `logbook_entry_revisions`, the entry is marked "edited by admin" and the tutor can see what
changed. Anything touching the schedule or the hours (a lesson that did not happen) goes back to the tutor, who
cancels it, which returns the hours.

**Considered.** Only request-changes (slow for a typo, delays pay and the families' access); only admin edits
(the admin rewrites something they did not witness, accountability blurs); per-entry approval (conflicts with
"one logbook per month, read-only once approved"); rejecting the whole month (throws away correct work).
*The tutor owns the record of what happened in their lessons; the admin owns the decision to publish it.*

**Weak spots.** An admin could edit too readily; the revision trail makes it visible. **Enforced in.**
`request_logbook_changes`, `admin_edit_entry`, triggers `entries_lock_check`, `logbooks_approved_check`
(`fn_logbooks`).

### 5. How an invoice becomes Paid, who can mark it, and whether it can be undone

There is no payment gateway, so **only the person who can see the bank statement can say that money arrived:
the admin.** A student who could press "Confirm payment" could grant themselves access; I designed that first
and dropped it.

**5a. Marking Paid.** The student presses *I have paid* with sender name, bank, date and amount (a proof image
is optional and private; a screenshot can be edited, so it only helps the admin find the transfer). The invoice
becomes *Awaiting verification*; the admin verifies it against the bank statement (the reported amount must
cover the invoice) or rejects it with a reason. The admin can also record a cash or directly checked payment.
With a real gateway its webhook would call the same verification logic.

**5b. Undoing.** Only the admin, with a reason, and only while none of that invoice's hours have been used
(hours are consumed oldest-invoice first). The payment row is kept and marked reversed. A student who already
had lessons is a refund or collection matter, not a recording mistake. Paying twice is impossible: the function
locks the invoice and a second call is refused.

**5c. Seat lock and time windows.** Transfers happen outside the system, so the seat has to be locked *before*
the account number is shown: enrolling holds the seat and starts a 24 hour window. Cancelling frees the seat.
No report in 24 hours: enrollment and invoice expire and the seat is released. After the student reports, the
seat stays locked until the admin decides; there is deliberately no automatic timeout, because expiring would
punish a family for the admin's delay and auto-approving would grant access without checking the money. Reports
waiting over 24 hours are flagged Overdue on the admin's overview. *Considered:* locking at "I have paid" or at
verification (two people can both transfer for the last seat), a 3 hour window (too short for a family enrolling
at night), a 3 day hold (half of a 2-seat class held by someone who may not pay).

**5d. Late transfers and refunds.** A report after the window: if the seat is still free it is revived and
honoured at the original price; if the class filled up meanwhile the payment is flagged and verifying it creates
a full refund of the invoice amount (no service was ever given, so the no-refund rule for leavers does not apply).
Refunds are records of an obligation (*pending → refunded* with the bank reference, or *cancelled*), visible to
the admin and the student.

**Enforced in.** `report_payment`, `verify_payment`, `reject_payment`, `mark_paid_offline`, `reverse_payment`,
`run_scheduled_jobs`, `mark_refunded` (`fn_payments`, `fn_hours`, `fn_lifecycle`).

## Improvements

The brief asks for improvements that solve real problems from *How the business works*. The required flow alone
does not solve them (a student seeing their own hours tells the admin nothing about who is running out), so for
each I state what was required and what I added.

**I1. Money and hours overview (admin).** *Problem:* the admin cannot easily tell how many hours each student has
left or which invoices are unpaid. *Required:* students see their own hours; the admin can list invoices.
*Added:* one page with every student's hours (Low at 3 hours or less, Out of hours), payments waiting to be
verified (red after 24 hours), unpaid renewals, refunds to repay, seats per class and the amount still
outstanding, as a list of things to act on. *Why this over alternatives:* a CSV export sends the admin back to
a spreadsheet; per-student pages mean opening twenty of them; reminders need a messaging service and still give
no overview. *Left out:* notifications, filtering and search, export.

**I2. Class profitability (admin).** *Problem:* the admin cannot tell whether a class is profitable. *Required:*
nothing in the business flow. *Added:* revenue counted from hours actually used (at each invoice's own rate),
tutor cost (approved plus an estimate for lessons taught but not yet approved), margin and percentage, cash
received, refunds, the "paid but not delivered" balance, margin per hour at today's enrolment, the break-even
number of students and a warning when the student rate is below the tutor rate. *Why:* cash in minus tutor pay
is misleading for prepaid packages (two students paying Rp3,600,000 in month one would show a Rp3,000,000 profit
after Rp600,000 of lessons). *Left out:* overhead, trends, forecasting.

**I3. Tutor earnings statement.** *Problem:* tutors ask the admin every month what they will be paid. *Required:*
earnings per lesson and in total (known only after approval). *Added:* every lesson with its status (scheduled,
taught, submitted, approved), final versus estimated totals, a month selector and a list of lessons that still
need an entry. One SQL function computes a lesson's earning and is used by the statement, the admin's preview
and the approval, so the estimate equals the final amount unless a lesson is cancelled during review. *Left out:*
payout records, payslips, tax.

### Smaller additions built on top

These are not among the three main improvements; each answers one more sentence of *How the business works*.

- **Progress page for students and parents.** *"Parents and students rely on [the logbook] to follow progress."* The
  class page opens with *What's next* (the latest approved entry's recommendation) and the topics covered so far,
  built only from approved logbooks (the database already hides everything else).
- **Recurring lessons.** A tutor schedules "every Monday 16:00–17:30 WIB for 8 weeks" in one step. It is all or
  nothing against the overlap rule: if any week clashes, nothing is created and every clashing date is listed.
  Each lesson stays an ordinary lesson, so it can still be cancelled on its own.
- **In-app notifications.** *"Today this runs on spreadsheets and WhatsApp."* A bell with an unread count for
  invoices, payment decisions, cancelled lessons, logbook submissions, change requests and approvals, and refunds.
  They are written by database triggers on the tables where the events happen, so no code path can forget to notify;
  everyone reads only their own. Delivery by e-mail or WhatsApp is left out.
- **Waitlist with a priority window.** When a class is full students can queue. When a seat frees up (payment window
  expired, payment rejected, cancellation, withdrawal or a larger capacity) the first in line is offered it for 24
  hours and nobody else can take it; an unused offer passes to the next student. *Left out:* offering several seats
  at once to a group, and automatically enrolling the student.

## Known weaknesses

- The no-refund rule for students who leave may need legal review (see 3c). A student withdrawn after not
  renewing forfeits the leftover (always less than one lesson, at most Rp225,000) unless the admin issues an
  exception refund.
- A student can hold a seat for 24 hours without paying, and re-enroll afterwards; there is no cool-down.
- A late transfer on a class that filled up needs the admin to repay by hand (the refund record makes sure it
  is not forgotten).
- Rate changes cannot be scheduled for a future date; there are no notifications.
- Payments are simulated; a screenshot is not proof, only a hint for the admin.
- Badge text uses the brief's exact colours, which is below AA contrast for small white text (see ARCHITECTURE.md).
- The seeded accounts share one documented password; a deployed copy should turn off the demo-login list and
  change them.

## What I would build next with another day

1. **Delivery of notifications** beyond the in-app bell (WhatsApp or e-mail), with per-user preferences and
   reminders before a payment window ends: the product replaces WhatsApp threads, so this is the biggest gap.
2. **Excused absences** as an opt-in per-class quota, switched on once data shows it is worth Rp225,000 per absence.
3. **Unique transfer codes** (Rp1,800,123) so transfers match the bank statement automatically, then bank
   statement import, then a real payment gateway behind the same verification function.
4. **Correction invoices** for hours already used when a payment turns out to be invalid; payouts and payslips
   for tutors; per-class payment window and renewal threshold; scheduled (future-dated) rate changes.
5. A **diff view** for admin edits to logbooks, search and filters, browser-level end-to-end tests, and
   deployment (hosted Supabase + Vercel).
6. A **re-enroll cool-down** against holding a seat for 24 hours repeatedly without paying.
7. A **legal review** of the refund clause and of the data held about minors.
