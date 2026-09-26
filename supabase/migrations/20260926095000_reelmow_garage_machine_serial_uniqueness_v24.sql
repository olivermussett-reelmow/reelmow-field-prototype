create unique index if not exists machines_garage_serial_number_ci_uq
on garage.machines (garage_id, lower(btrim(serial_number)))
where serial_number is not null and btrim(serial_number) <> '';
