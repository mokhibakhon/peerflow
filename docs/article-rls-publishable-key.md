---
title: "Your Supabase anon key can probably read your whole users table"
published: false
tags: supabase, postgres, security, webdev
canonical_url:
description: A row-level security policy that looks correct, documents its own hole in a comment, and hands every row to anyone with the publishable key.
---

Here is a Supabase row-level security policy. It was on a `profiles` table holding
names, timezones and weekly availability for real people.

```sql
create policy "profiles are viewable"
  on public.profiles for select using (
    id = auth.uid() or not public.blocked_with(id)
  );
```

It reads as: *you can see your own row, and anyone who hasn't blocked you.* That is
what it does — for a signed-in caller.

For a caller with no session, `auth.uid()` is `null`. `id = null` is `null`, not
true. And `blocked_with(id)` returns false for every row, because it is an
`exists()` over a table of block pairs and there is no identity to find a pair
for. So the expression becomes `null or not false`, which is `true`. For every
row.

Rather than trust that reading, evaluate it. Against a real Postgres, as `anon`:

```sql
set role anon;
select auth.uid()                     as auth_uid,
       (some_id = auth.uid())         as id_eq_uid,
       blocked_with(some_id)          as blocked_with,
       (some_id = auth.uid()
         or not blocked_with(some_id)) as whole_policy;
```

```
 auth_uid | id_eq_uid | blocked_with | whole_policy
----------+-----------+--------------+--------------
          |           | f            | t
```

Two nulls and a false, and the policy still says yes. It is `using (true)` with
extra steps, whenever nobody is logged in.

## The comment already said so

This is the part I keep thinking about. The migration that introduced the policy
explained itself:

```sql
-- With the grant in place the plain expression is right and needs no guard: a
-- signed-out caller has no identity, so blocked_with returns false for every
-- row and the policy reads exactly as `true` used to.
```

Every word of that is correct. It was written to justify a different decision —
whether the expression needed a `case` guard for evaluation order — and in the
course of justifying it, it stated the hole precisely. Then it read as reassuring
for months, because the sentence ends on "as `true` used to", and `true` was what
the table had before, and nobody re-asked whether `true` was still an acceptable
answer now that the table held people's schedules.

A bug that is written down, accurately, in a comment, is not a rare kind of bug.
It is a comment that answers the question it was asked and not the question that
mattered.

## "But you have to be logged in to see that page"

The app has a people directory. Open it signed out and it bounces you to login.
That is correct behaviour and it is not protection.

The redirect is JavaScript. It runs in the browser, after the page has loaded,
because the page is what runs it. Nobody reading your users would load the page.
They would do this:

```bash
curl "https://<project>.supabase.co/rest/v1/profiles?select=*" \
  -H "apikey: <your publishable key>"
```

The publishable key is designed to be public. It ships in the client bundle of
every Supabase app; mine is committed to a public repository on purpose. It is
not a secret and was never meant to be one.

Two things gate what it can reach: the `GRANT` on the table, and the RLS policy.
Supabase's default setup grants `select` on your public tables to `anon` — that
is what makes an anonymous client work at all — so in practice **the policy is
the only thing deciding what comes back.** When it evaluates to `true` for
anonymous callers, the key is a full table read.

What came back in my case was name, learning track, level, timezone, and a weekly
availability grid. Individually dull. Together: *when is this person alone at
their computer* — published to anyone who asks, for a product whose users are
about to meet strangers one-to-one on camera.

## The fix that doesn't work

```sql
using (
  auth.uid() is not null
  and (id = auth.uid() or not public.blocked_with(id))
)
```

One line, correct, and it broke the landing page.

The marketing page shows "3 waiting" on each learning-path card. It got those
numbers by reading `profiles` anonymously and counting rows in the browser. Add
the session requirement and all eight cards silently become "be the first" — on
the page whose entire job is convincing someone to sign up.

I nearly shipped that. I had written "nothing depends on anonymous reads" before
grepping for callers, and there was one, on the most important page on the site.

## Publish the aggregate, not the records

The landing page never needed the rows. It needed eight numbers. So the numbers
get their own function:

```sql
create or replace function public.track_counts()
returns table (track_id text, learners bigint)
language sql
security definer
stable
set search_path = public
as $$
  select p.track_id, count(*)
    from public.profiles p
   where p.track_id is not null
   group by p.track_id
$$;

revoke all on function public.track_counts() from public;
grant execute on function public.track_counts() to anon, authenticated;
```

`security definer` so it can count rows the caller may no longer read. No
argument, no filter, and a return type that can only be a track id and a total —
there is no way to ask it about a person. Then the policy gets its session
requirement, and the anonymous read returns `[]`.

The general shape: **when an anonymous surface needs a number derived from
private rows, give it the number.** Don't give it the rows and a `count()` in
JavaScript.

Two things I deliberately did not do:

- **Revoke `select` on the table from `anon`.** It would be a second lock on the
  same door, and it changes the failure mode from "empty list" to "permission
  error" on the sign-up path, where the session may not have settled yet. Zero
  rows is the security property. The policy is the mechanism.
- **Drop `security definer` for `security invoker`.** The function's whole job is
  reading rows the caller cannot. That is what definer is for. The safety comes
  from its signature having no way to name a person.

## Two Postgres details worth knowing

**`EXECUTE` is checked when the expression is prepared, not when a branch is
taken.** My policy still calls `blocked_with()` in an expression that `anon`
prepares. If `anon` lacked `EXECUTE` on it, anonymous queries would fail with a
permission error instead of returning zero rows — a different, noisier bug. The
grant has to stay, even though the branch is now unreachable for anonymous
callers. My regression test asserts the refusal is *clean* — zero rows, not an
error — precisely because those two failures look identical from a distance and
mean different things.

**Postgres does not promise to evaluate `AND` left to right.** You cannot assume
`auth.uid() is not null` short-circuits the rest. If the right-hand side must not
run, use `case`. Here it is only a performance question, but if your guard is
protecting against an error rather than a leak, it matters.

## Go and check yours

This takes ten seconds. Against your own project:

```bash
curl "https://<project>.supabase.co/rest/v1/<table>?select=*&limit=5" \
  -H "apikey: <your publishable key>"
```

No `Authorization` header — that is the point, you are testing the anonymous
path. If rows come back that a stranger should not have, you have this bug.

Worth doing for every table, not just the obvious one. The policy that leaks is
rarely `using (true)`, because that one looks wrong. It is the one that reads
correctly and quietly degenerates to `true` when a value is null.

---

*Found while hardening [PeerFlow](https://www.peerflow.dev), where people match
with one study partner and meet on camera each week. Which is exactly why a table
of names, timezones and availability was the wrong one to leave readable.*
