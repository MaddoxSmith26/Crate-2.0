-- Crate migration 0003: borrowing between family members, in-app notifications.

-- ----------------------------------------------------------- notifications
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  data jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;

create policy "notifications: read your own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: mark your own read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: clear your own" on public.notifications
  for delete to authenticated using (user_id = auth.uid());
-- Notifications are created only by the database functions in these migrations.

create function public.notify(p_user uuid, p_kind text, p_title text, p_body text, p_data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, title, body, data)
  values (p_user, p_kind, p_title, coalesce(p_body, ''), coalesce(p_data, '{}'));
$$;
revoke execute on function public.notify(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------- loans
create table public.loans (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.copies (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  borrower_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'declined', 'returned', 'canceled')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  returned_at timestamptz,
  last_reminded_at timestamptz,
  check (owner_id <> borrower_id)
);
-- A record can be out with one person at a time, and one open ask per person.
create unique index loans_one_approved_per_copy on public.loans (copy_id) where status = 'approved';
create unique index loans_one_request_per_borrower on public.loans (copy_id, borrower_id) where status = 'requested';
create index loans_borrower on public.loans (borrower_id);
create index loans_owner on public.loans (owner_id);
alter table public.loans enable row level security;

-- The two people involved see everything about a loan. The rest of the
-- owner's group can see approved loans, so the shared collection can show
-- who has a record.
create policy "loans: read your own, and your group's active loans" on public.loans
  for select to authenticated using (
    owner_id = auth.uid()
    or borrower_id = auth.uid()
    or (status = 'approved' and public.shares_group_with(owner_id))
  );
-- Loans change only through the functions below.

create function public.loan_album_title(p_copy uuid) returns text
language sql stable security definer set search_path = public as $$
  select a.title from public.copies c join public.albums a on a.id = c.album_id where c.id = p_copy;
$$;
revoke execute on function public.loan_album_title(uuid) from public, anon, authenticated;

create function public.my_name() returns text
language sql stable security definer set search_path = public as $$
  select display_name from public.profiles where id = auth.uid();
$$;
revoke execute on function public.my_name() from public, anon, authenticated;

create function public.request_loan(p_copy uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_copy public.copies;
  v_loan uuid;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select * into v_copy from public.copies where id = p_copy and removed_at is null;
  if not found then raise exception 'record_not_found'; end if;
  if v_copy.owner_id = auth.uid() then raise exception 'cannot_borrow_your_own_record'; end if;
  if not public.shares_group_with(v_copy.owner_id) then raise exception 'not_in_same_group'; end if;
  if exists (select 1 from public.loans where copy_id = p_copy and status = 'approved') then
    raise exception 'record_already_lent_out';
  end if;
  if exists (select 1 from public.loans where copy_id = p_copy and borrower_id = auth.uid() and status = 'requested') then
    raise exception 'already_requested';
  end if;

  insert into public.loans (copy_id, owner_id, borrower_id)
  values (p_copy, v_copy.owner_id, auth.uid()) returning id into v_loan;

  perform public.notify(v_copy.owner_id, 'loan_requested',
    public.my_name() || ' wants to borrow ' || public.loan_album_title(p_copy),
    'Approve or decline in the Family tab.',
    jsonb_build_object('loan_id', v_loan, 'album_id', v_copy.album_id));
  return v_loan;
end;
$$;

create function public.decide_loan(p_loan uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_title text;
  v_album uuid;
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.owner_id is distinct from auth.uid() then raise exception 'loan_not_found'; end if;
  if v_loan.status <> 'requested' then raise exception 'loan_already_decided'; end if;
  v_title := public.loan_album_title(v_loan.copy_id);
  select album_id into v_album from public.copies where id = v_loan.copy_id;

  if p_approve then
    if exists (select 1 from public.loans where copy_id = v_loan.copy_id and status = 'approved') then
      raise exception 'record_already_lent_out';
    end if;
    update public.loans set status = 'approved', decided_at = now() where id = p_loan;
    perform public.notify(v_loan.borrower_id, 'loan_approved',
      public.my_name() || ' said yes: ' || v_title,
      'It is yours to play and rate until you give it back.',
      jsonb_build_object('loan_id', p_loan, 'album_id', v_album));
  else
    update public.loans set status = 'declined', decided_at = now() where id = p_loan;
    perform public.notify(v_loan.borrower_id, 'loan_declined',
      public.my_name() || ' declined: ' || v_title, '',
      jsonb_build_object('loan_id', p_loan, 'album_id', v_album));
  end if;
end;
$$;

-- Either person can mark a record as returned.
create function public.return_loan(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_loan public.loans;
  v_other uuid;
  v_album uuid;
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or auth.uid() is null or auth.uid() not in (v_loan.owner_id, v_loan.borrower_id) then
    raise exception 'loan_not_found';
  end if;
  if v_loan.status <> 'approved' then raise exception 'loan_not_active'; end if;
  update public.loans set status = 'returned', returned_at = now() where id = p_loan;
  v_other := case when auth.uid() = v_loan.owner_id then v_loan.borrower_id else v_loan.owner_id end;
  select album_id into v_album from public.copies where id = v_loan.copy_id;
  perform public.notify(v_other, 'loan_returned',
    public.loan_album_title(v_loan.copy_id) || ' is back with its owner',
    public.my_name() || ' marked it as returned.',
    jsonb_build_object('loan_id', p_loan, 'album_id', v_album));
end;
$$;

create function public.cancel_loan_request(p_loan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.loans set status = 'canceled', decided_at = now()
  where id = p_loan and borrower_id = auth.uid() and status = 'requested';
  if not found then raise exception 'loan_not_found'; end if;
end;
$$;

-- Reminders, in-app only. There is no background scheduler in version one, so
-- the app calls this when it opens. A loan out for 14 days or more gets a
-- reminder for both people, at most once every 7 days.
create function public.refresh_loan_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_loan record;
  v_count int := 0;
  v_days int;
begin
  if auth.uid() is null then return 0; end if;
  for v_loan in
    select l.*, a.title, c.album_id, o.display_name as owner_name, b.display_name as borrower_name
    from public.loans l
    join public.copies c on c.id = l.copy_id
    join public.albums a on a.id = c.album_id
    join public.profiles o on o.id = l.owner_id
    join public.profiles b on b.id = l.borrower_id
    where l.status = 'approved'
      and auth.uid() in (l.owner_id, l.borrower_id)
      and l.decided_at < now() - interval '14 days'
      and (l.last_reminded_at is null or l.last_reminded_at < now() - interval '7 days')
    for update of l
  loop
    v_days := floor(extract(epoch from now() - v_loan.decided_at) / 86400);
    perform public.notify(v_loan.borrower_id, 'loan_reminder',
      'You still have ' || v_loan.title,
      'Borrowed from ' || v_loan.owner_name || ' ' || v_days || ' days ago.',
      jsonb_build_object('loan_id', v_loan.id, 'album_id', v_loan.album_id));
    perform public.notify(v_loan.owner_id, 'loan_reminder',
      v_loan.borrower_name || ' still has ' || v_loan.title,
      'Lent out ' || v_days || ' days ago.',
      jsonb_build_object('loan_id', v_loan.id, 'album_id', v_loan.album_id));
    update public.loans set last_reminded_at = now() where id = v_loan.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.request_loan(uuid) from public, anon;
revoke execute on function public.decide_loan(uuid, boolean) from public, anon;
revoke execute on function public.return_loan(uuid) from public, anon;
revoke execute on function public.cancel_loan_request(uuid) from public, anon;
revoke execute on function public.refresh_loan_reminders() from public, anon;
grant execute on function public.request_loan(uuid) to authenticated;
grant execute on function public.decide_loan(uuid, boolean) to authenticated;
grant execute on function public.return_loan(uuid) to authenticated;
grant execute on function public.cancel_loan_request(uuid) to authenticated;
grant execute on function public.refresh_loan_reminders() to authenticated;

-- A record cannot be removed from a collection while it is lent out.
-- Removing it also closes any open requests for it.
create function public.guard_copy_removal() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.removed_at is not null and old.removed_at is null then
    if exists (select 1 from public.loans where copy_id = new.id and status = 'approved') then
      raise exception 'record_is_lent_out' using hint = 'Mark it as returned first.';
    end if;
    update public.loans set status = 'declined', decided_at = now()
    where copy_id = new.id and status = 'requested';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_copy_removal() from public, anon, authenticated;
create trigger copies_guard_removal before update on public.copies
  for each row execute function public.guard_copy_removal();

-- The borrower can rate the record while they have it.
create or replace function public.can_rate_album(p_album uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.copies
    where owner_id = auth.uid() and album_id = p_album and removed_at is null
  ) or exists (
    select 1 from public.loans l
    join public.copies c on c.id = l.copy_id
    where l.borrower_id = auth.uid() and l.status = 'approved' and c.album_id = p_album
  );
$$;

-- Collection rows now say who a record is lent to.
drop view public.collection_items;
create view public.collection_items with (security_invoker = true) as
select
  c.id as copy_id,
  c.owner_id,
  p.display_name as owner_name,
  c.album_id,
  a.title,
  a.artist,
  a.year,
  a.cover_url,
  c.pressing_note,
  c.added_at,
  l.id as loan_id,
  l.borrower_id as lent_to,
  b.display_name as lent_to_name,
  l.decided_at as lent_at
from public.copies c
join public.albums a on a.id = c.album_id
join public.profiles p on p.id = c.owner_id
left join public.loans l on l.copy_id = c.id and l.status = 'approved'
left join public.profiles b on b.id = l.borrower_id
where c.removed_at is null;

-- Loans with names and album details, for the Family tab.
create view public.loan_details with (security_invoker = true) as
select
  l.id as loan_id,
  l.copy_id,
  l.status,
  l.owner_id,
  o.display_name as owner_name,
  l.borrower_id,
  b.display_name as borrower_name,
  c.album_id,
  a.title,
  a.artist,
  a.cover_url,
  l.requested_at,
  l.decided_at,
  l.returned_at
from public.loans l
join public.copies c on c.id = l.copy_id
join public.albums a on a.id = c.album_id
join public.profiles o on o.id = l.owner_id
join public.profiles b on b.id = l.borrower_id;

-- The shelf: records a person has on hand right now. Owned and not lent out,
-- plus records they are borrowing. "What to play next" reads only this.
create view public.shelf_items with (security_invoker = true) as
select
  c.owner_id as holder_id,
  c.id as copy_id,
  c.album_id,
  a.title, a.artist, a.year, a.cover_url, a.genres,
  false as borrowed,
  c.owner_id,
  p.display_name as owner_name
from public.copies c
join public.albums a on a.id = c.album_id
join public.profiles p on p.id = c.owner_id
where c.removed_at is null
  and not exists (select 1 from public.loans l where l.copy_id = c.id and l.status = 'approved')
union all
select
  l.borrower_id as holder_id,
  c.id as copy_id,
  c.album_id,
  a.title, a.artist, a.year, a.cover_url, a.genres,
  true as borrowed,
  c.owner_id,
  p.display_name as owner_name
from public.loans l
join public.copies c on c.id = l.copy_id
join public.albums a on a.id = c.album_id
join public.profiles p on p.id = c.owner_id
where l.status = 'approved' and c.removed_at is null;
