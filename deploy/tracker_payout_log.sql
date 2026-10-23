-- Payout log: record who pressed the pay button.
alter table payments add column if not exists paid_by text;
notify pgrst, 'reload schema';
