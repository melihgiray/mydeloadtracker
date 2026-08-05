-- 0018 - Make self-reported lift weights follow the same canonical-kilogram
-- boundary as logged workout sets.
--
-- Planner v2 originally stored the number typed into the form. That was only
-- correct for athletes using kilograms: a 225 lb bench was stored as 225 kg
-- and was reinterpreted whenever the athlete changed units.
--
-- `weight_storage_unit` is deliberately explicit. Besides documenting the
-- invariant, it makes this migration idempotent: a legacy pound row is divided
-- once, marked as kilograms, and never divided again on a rerun.

alter table public.athlete_lifts
  add column if not exists weight_storage_unit text;

-- Rows written before this migration are in the owner's display unit.
-- Kilogram rows keep the same value; pound rows become canonical kilograms.
update public.athlete_lifts as lift
set weight = case
      when profile.units = 'lb' then lift.weight / 2.2046226218
      else lift.weight
    end,
    weight_storage_unit = 'kg'
from public.profiles as profile
where lift.user_id = profile.id
  and lift.weight_storage_unit is null;

-- A profile should exist for every auth user. If an orphaned row predates that
-- invariant, preserve its numeric value rather than guessing a conversion.
update public.athlete_lifts
set weight_storage_unit = 'kg'
where weight_storage_unit is null;

alter table public.athlete_lifts
  alter column weight_storage_unit set default 'kg',
  alter column weight_storage_unit set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.athlete_lifts'::regclass
      and conname = 'athlete_lifts_weight_storage_unit_check'
  ) then
    alter table public.athlete_lifts
      add constraint athlete_lifts_weight_storage_unit_check
      check (weight_storage_unit = 'kg');
  end if;
end
$$;

-- The API already rejects zero-weight claims. Keep old zero rows from blocking
-- the migration while enforcing the stronger invariant for new writes.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.athlete_lifts'::regclass
      and conname = 'athlete_lifts_weight_positive_check'
  ) then
    alter table public.athlete_lifts
      add constraint athlete_lifts_weight_positive_check
      check (weight > 0) not valid;
  end if;
end
$$;
