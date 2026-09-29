-- 004: profiles table ki security aur mazboot karna.
-- Supabase Dashboard > SQL Editor me chalayein (001-003 ke baad). Dobara chalana safe hai.

-- 1) Anonymous (logged-out) role ko profiles tak koi rasai nahi.
revoke all on table public.profiles from anon;

-- 2) Logged-in users sirf yeh columns likh sakte hain. id, created_at, updated_at
--    column level pe hi band hain, is liye direct database access se bhi user apna
--    id ya timestamps nahi badal sakta. (Row level par RLS policies 002 me hain.)
revoke insert, update, delete on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, full_name, phone, avatar_url, bio) on table public.profiles to authenticated;
grant update (full_name, phone, avatar_url, bio) on table public.profiles to authenticated;

-- 3) Delete ki koi policy nahi: profile sirf auth user delete hone par cascade se hatti hai.
drop policy if exists "Users can delete their own profile" on public.profiles;

-- 4) RLS on (FORCE nahi: signup trigger table owner ki haisiyat se profile banata hai).
alter table public.profiles enable row level security;

-- 5) Policies dobara saaf taur par (002 jaisi, idempotent).
drop policy if exists "Users can view their own profile" on public.profiles;
create policy "Users can view their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
on public.profiles
for insert
to authenticated
with check ((select auth.uid()) = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);
