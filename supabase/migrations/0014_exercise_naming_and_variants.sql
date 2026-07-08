-- 0014 - Exercise naming clarity + missing common variants.
--
-- Renames two lifts to the names lifters actually use (the search alias layer
-- in the app covers the old names), unhides the rope pushdown, and inserts two
-- staples that never existed. Idempotent; standards keep working through the
-- alias map in standards.ts.

-- "Reverse Pec Deck" is the same machine everyone calls the reverse fly.
update public.exercises set name = 'Machine Reverse Fly', hidden = false
  where user_id is null and name = 'Reverse Pec Deck'
  and not exists (select 1 from public.exercises e2 where e2.user_id is null and e2.name = 'Machine Reverse Fly');

-- strengthlevel's "Machine Calf Raise" depicts the STANDING machine, and this
-- row was our Standing Calf Raise before 0011 renamed it. Name it what it is;
-- standards still resolve via the alias map. Seated Calf Raise stays separate
-- (the plate-loaded bench).
update public.exercises set name = 'Standing Calf Raise', hidden = false
  where user_id is null and name = 'Machine Calf Raise'
  and not exists (select 1 from public.exercises e2 where e2.user_id is null and e2.name = 'Standing Calf Raise');

-- The rope attachment version is its own staple, not a duplicate.
update public.exercises set hidden = false
  where user_id is null and name = 'Rope Pushdown';

-- Genuinely missing staples.
insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
  select null, 'Seated Dumbbell Curl', 'Biceps', 'Elbow Flexion', 'dumbbell', false
  where not exists (select 1 from public.exercises where user_id is null and name = 'Seated Dumbbell Curl');

insert into public.exercises (user_id, name, muscle_group, movement_pattern, equipment, is_major)
  select null, 'Assisted Pull-Up', 'Back', 'Vertical Pull', 'machine', false
  where not exists (select 1 from public.exercises where user_id is null and name = 'Assisted Pull-Up');
