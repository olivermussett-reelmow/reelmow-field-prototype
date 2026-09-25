-- REELMOW backend v0.9
-- Index foreign keys used by active catalogue, Garage, service and ingestion paths.
begin;

create index if not exists documents_machine_model_id_idx on catalogue.documents(machine_model_id);
create index if not exists documents_machine_variant_id_idx on catalogue.documents(machine_variant_id);
create index if not exists documents_source_id_idx on catalogue.documents(source_id);
create index if not exists fact_sources_document_id_idx on catalogue.fact_sources(document_id);
create index if not exists fact_sources_document_page_id_idx on catalogue.fact_sources(document_page_id);
create index if not exists fact_sources_source_id_idx on catalogue.fact_sources(source_id);
create index if not exists facts_spec_definition_id_idx on catalogue.facts(spec_definition_id);
create index if not exists machine_models_product_family_id_idx on catalogue.machine_models(product_family_id);
create index if not exists part_fitments_machine_variant_id_idx on catalogue.part_fitments(machine_variant_id);
create index if not exists part_fitments_source_id_idx on catalogue.part_fitments(source_id);
create index if not exists service_schedule_rules_service_task_id_idx on catalogue.service_schedule_rules(service_task_id);
create index if not exists service_schedule_rules_source_id_idx on catalogue.service_schedule_rules(source_id);
create index if not exists service_tasks_source_id_idx on catalogue.service_tasks(source_id);
create index if not exists sources_manufacturer_id_idx on catalogue.sources(manufacturer_id);

create index if not exists machines_garage_id_idx on garage.machines(garage_id);
create index if not exists machines_machine_variant_id_idx on garage.machines(machine_variant_id);
create index if not exists machines_created_by_idx on garage.machines(created_by);
create index if not exists machine_documents_machine_id_idx on garage.machine_documents(machine_id);
create index if not exists machine_documents_created_by_idx on garage.machine_documents(created_by);
create index if not exists machine_hours_log_machine_id_idx on garage.machine_hours_log(machine_id);
create index if not exists machine_hours_log_created_by_idx on garage.machine_hours_log(created_by);
create index if not exists machine_photos_machine_id_idx on garage.machine_photos(machine_id);
create index if not exists machine_photos_created_by_idx on garage.machine_photos(created_by);
create index if not exists machine_service_records_machine_id_idx on garage.machine_service_records(machine_id);
create index if not exists machine_service_records_service_task_id_idx on garage.machine_service_records(service_task_id);
create index if not exists machine_service_records_created_by_idx on garage.machine_service_records(created_by);
create index if not exists memberships_user_id_idx on garage.memberships(user_id);
create index if not exists organizations_created_by_idx on garage.organizations(created_by);
create index if not exists audit_events_user_id_idx on garage.audit_events(user_id);

create index if not exists ai_runs_document_id_idx on ingestion.ai_runs(document_id);
create index if not exists extracted_facts_job_id_idx on ingestion.extracted_facts(job_id);
create index if not exists extracted_facts_document_page_id_idx on ingestion.extracted_facts(document_page_id);
create index if not exists extracted_facts_reviewed_by_idx on ingestion.extracted_facts(reviewed_by);
create index if not exists job_documents_document_id_idx on ingestion.job_documents(document_id);
create index if not exists jobs_manufacturer_id_idx on ingestion.jobs(manufacturer_id);
create index if not exists review_queue_fact_id_idx on ingestion.review_queue(fact_id);
create index if not exists review_queue_assigned_to_idx on ingestion.review_queue(assigned_to);

commit;
