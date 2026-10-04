CREATE OR REPLACE VIEW garage.machine_service_due AS
SELECT
  m.id AS machine_id,
  st.id AS service_task_id,
  st.task_key,
  st.task_name,
  st.instructions,
  st.safety_notes,
  st.confidence AS task_confidence,
  st.source_id,
  st.source_page,
  m.current_engine_hours,
  m.current_reel_hours,
  ls.serviced_at AS last_serviced_at,
  ls.engine_hours AS last_service_engine_hours,
  ls.reel_hours AS last_service_reel_hours,
  count(DISTINCT sr.id)::integer AS rule_count,
  min(sr.interval_engine_hours) FILTER (WHERE sr.interval_engine_hours IS NOT NULL) AS interval_engine_hours,
  min(sr.interval_reel_hours) FILTER (WHERE sr.interval_reel_hours IS NOT NULL) AS interval_reel_hours,
  min(sr.interval_calendar_days) FILTER (WHERE sr.interval_calendar_days IS NOT NULL) AS interval_calendar_days,
  CASE
    WHEN ls.serviced_at IS NULL
      AND (
        (min(sr.interval_engine_hours) IS NOT NULL AND m.current_engine_hours IS NOT NULL AND min(sr.applies_from_engine_hours) IS NULL)
        OR
        (min(sr.interval_reel_hours) IS NOT NULL AND m.current_reel_hours IS NOT NULL AND min(sr.applies_from_reel_hours) IS NULL)
      )
      AND NOT (
        min(sr.interval_calendar_days) IS NOT NULL
        AND (COALESCE(ls.serviced_at, m.created_at) + make_interval(days => min(sr.interval_calendar_days)))::date <= CURRENT_DATE
      )
    THEN NULL::numeric
    ELSE LEAST(
      min(CASE
        WHEN sr.interval_engine_hours IS NULL OR m.current_engine_hours IS NULL OR sr.schedule_type <> ALL (ARRAY['recurring','inspection']) THEN NULL::numeric
        WHEN ls.engine_hours IS NOT NULL THEN ls.engine_hours + sr.interval_engine_hours - m.current_engine_hours
        WHEN sr.applies_from_engine_hours IS NOT NULL THEN sr.applies_from_engine_hours - m.current_engine_hours
        ELSE sr.interval_engine_hours - m.current_engine_hours
      END),
      min(CASE
        WHEN sr.interval_reel_hours IS NULL OR m.current_reel_hours IS NULL OR sr.schedule_type <> ALL (ARRAY['recurring','inspection']) THEN NULL::numeric
        WHEN ls.reel_hours IS NOT NULL THEN ls.reel_hours + sr.interval_reel_hours - m.current_reel_hours
        WHEN sr.applies_from_reel_hours IS NOT NULL THEN sr.applies_from_reel_hours - m.current_reel_hours
        ELSE sr.interval_reel_hours - m.current_reel_hours
      END)
    )
  END AS hours_remaining,
  min(CASE
    WHEN sr.interval_calendar_days IS NOT NULL THEN (COALESCE(ls.serviced_at, m.created_at) + make_interval(days => sr.interval_calendar_days))::date
    ELSE NULL::date
  END) AS calendar_due_date,
  CASE
    WHEN bool_or(
      sr.interval_engine_hours IS NOT NULL
      AND m.current_engine_hours IS NOT NULL
      AND sr.schedule_type = ANY (ARRAY['recurring','inspection'])
      AND CASE
        WHEN ls.engine_hours IS NOT NULL THEN (ls.engine_hours + sr.interval_engine_hours - m.current_engine_hours) <= 0
        WHEN sr.applies_from_engine_hours IS NOT NULL THEN (sr.applies_from_engine_hours - m.current_engine_hours) <= 0
        ELSE FALSE
      END
      OR sr.interval_reel_hours IS NOT NULL
      AND m.current_reel_hours IS NOT NULL
      AND sr.schedule_type = ANY (ARRAY['recurring','inspection'])
      AND CASE
        WHEN ls.reel_hours IS NOT NULL THEN (ls.reel_hours + sr.interval_reel_hours - m.current_reel_hours) <= 0
        WHEN sr.applies_from_reel_hours IS NOT NULL THEN (sr.applies_from_reel_hours - m.current_reel_hours) <= 0
        ELSE FALSE
      END
      OR sr.interval_calendar_days IS NOT NULL
      AND (COALESCE(ls.serviced_at, m.created_at) + make_interval(days => sr.interval_calendar_days))::date <= CURRENT_DATE
    ) THEN 'due'
    WHEN ls.serviced_at IS NULL
      AND (
        (min(sr.interval_engine_hours) IS NOT NULL AND m.current_engine_hours IS NOT NULL AND min(sr.applies_from_engine_hours) IS NULL)
        OR
        (min(sr.interval_reel_hours) IS NOT NULL AND m.current_reel_hours IS NOT NULL AND min(sr.applies_from_reel_hours) IS NULL)
      )
    THEN 'history_unknown'
    ELSE 'upcoming'
  END AS service_status
FROM garage.machines m
JOIN catalogue.machine_variants mv ON mv.id = m.machine_variant_id
JOIN catalogue.service_tasks st ON st.machine_variant_id = mv.id AND st.status = 'active'::catalogue.record_status
JOIN catalogue.service_schedule_rules sr ON sr.service_task_id = st.id AND sr.status = 'active'::catalogue.record_status
LEFT JOIN LATERAL (
  SELECT x.serviced_at, x.engine_hours, x.reel_hours
  FROM garage.machine_service_records x
  WHERE x.machine_id = m.id AND x.service_task_id = st.id
  ORDER BY x.serviced_at DESC, x.created_at DESC
  LIMIT 1
) ls ON true
GROUP BY
  m.id, st.id, st.task_key, st.task_name, st.instructions, st.safety_notes,
  st.confidence, st.source_id, st.source_page, m.current_engine_hours,
  m.current_reel_hours, ls.serviced_at, ls.engine_hours, ls.reel_hours;
