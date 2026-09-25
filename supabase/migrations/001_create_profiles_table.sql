create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  bio text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 100),
  constraint profiles_phone_length check (phone is null or char_length(phone) <= 30),
  constraint profiles_avatar_url_length check (avatar_url is null or char_length(avatar_url) <= 2048),
  constraint profiles_bio_length check (bio is null or char_length(bio) <= 500)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();
