-- Migration number: 0009 	 2026-01-17T03:28:00.000Z
-- Seed default workspace + templates + rules + steps

INSERT OR IGNORE INTO workspaces (id, name, created_at, updated_at)
VALUES ('default', 'Default', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO templates (
  id, workspace_id, key, title, scope, category_key, deliverable_key, is_active, created_at, updated_at
) VALUES
  ('core.project.intake', 'default', 'core.project.intake', 'Project Intake', 'project', NULL, NULL, 1, datetime('now'), datetime('now')),
  ('core.project.materials_review', 'default', 'core.project.materials_review', 'Materials Review', 'project', NULL, NULL, 1, datetime('now'), datetime('now')),
  ('core.shared.samples', 'default', 'core.shared.samples', 'Samples', 'shared', NULL, NULL, 1, datetime('now'), datetime('now')),
  ('core.shared.install_planning', 'default', 'core.shared.install_planning', 'Install Planning', 'shared', NULL, NULL, 1, datetime('now'), datetime('now')),
  ('core.shared.delivery_planning', 'default', 'core.shared.delivery_planning', 'Delivery Planning', 'shared', NULL, NULL, 1, datetime('now'), datetime('now')),
  ('furniture.dining_table.base', 'default', 'furniture.dining_table.base', 'Dining Table Base', 'deliverable', 'furniture', 'dining_table', 1, datetime('now'), datetime('now')),
  ('furniture.dining_table.design', 'default', 'furniture.dining_table.design', 'Dining Table Design', 'deliverable', 'furniture', 'dining_table', 1, datetime('now'), datetime('now')),
  ('furniture.dining_table.approval', 'default', 'furniture.dining_table.approval', 'Dining Table Approval', 'deliverable', 'furniture', 'dining_table', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO template_rules (
  id, workspace_id, template_key, priority, match_json, is_active, created_at, updated_at
) VALUES
  ('rule_project_intake', 'default', 'core.project.intake', 100, '{"attach_to":"project"}', 1, datetime('now'), datetime('now')),
  ('rule_project_materials_review', 'default', 'core.project.materials_review', 90, '{"attach_to":"project"}', 1, datetime('now'), datetime('now')),
  ('rule_samples_shared', 'default', 'core.shared.samples', 80, '{"attach_to":"shared","flags_any":["requiresSamples"],"group_key_present":true}', 1, datetime('now'), datetime('now')),
  ('rule_samples_project', 'default', 'core.shared.samples', 70, '{"attach_to":"project","flags_any":["requiresSamples"],"group_key_present":false}', 1, datetime('now'), datetime('now')),
  ('rule_install_shared', 'default', 'core.shared.install_planning', 60, '{"attach_to":"shared","flags_any":["installRequired"]}', 1, datetime('now'), datetime('now')),
  ('rule_delivery_shared', 'default', 'core.shared.delivery_planning', 50, '{"attach_to":"shared","flags_any":["deliveryRequired"]}', 1, datetime('now'), datetime('now')),
  ('rule_dining_table_base', 'default', 'furniture.dining_table.base', 40, '{"attach_to":"deliverable","category_key":"furniture","deliverable_key":"dining_table"}', 1, datetime('now'), datetime('now')),
  ('rule_dining_table_design', 'default', 'furniture.dining_table.design', 30, '{"attach_to":"deliverable","category_key":"furniture","deliverable_key":"dining_table","flags_any":["requiresDesign"]}', 1, datetime('now'), datetime('now')),
  ('rule_dining_table_approval', 'default', 'furniture.dining_table.approval', 20, '{"attach_to":"deliverable","category_key":"furniture","deliverable_key":"dining_table","flags_any":["requiresApproval"]}', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO template_steps (
  id, workspace_id, template_key, position, step_key, title, kind, default_state_json, is_active, created_at, updated_at
) VALUES
  ('step_project_intake_contact_customer', 'default', 'core.project.intake', 1, 'contact_customer', 'Contact customer', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_project_intake_confirm_scope', 'default', 'core.project.intake', 2, 'confirm_scope', 'Confirm scope', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_project_intake_schedule_measure', 'default', 'core.project.intake', 3, 'schedule_measure', 'Schedule measure', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_project_materials_review_collect', 'default', 'core.project.materials_review', 1, 'collect_materials', 'Collect materials', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_project_materials_review_review', 'default', 'core.project.materials_review', 2, 'review_materials', 'Review materials', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_shared_samples_select', 'default', 'core.shared.samples', 1, 'select_materials', 'Select materials', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_shared_samples_prepare', 'default', 'core.shared.samples', 2, 'prepare_samples', 'Prepare samples', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_shared_samples_deliver', 'default', 'core.shared.samples', 3, 'deliver_samples', 'Deliver samples', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_shared_install_plan', 'default', 'core.shared.install_planning', 1, 'install_planning', 'Install planning', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_shared_delivery_plan', 'default', 'core.shared.delivery_planning', 1, 'delivery_planning', 'Delivery planning', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_dining_table_base_spec', 'default', 'furniture.dining_table.base', 1, 'spec_confirm', 'Confirm specs', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_dining_table_design_concepts', 'default', 'furniture.dining_table.design', 1, 'design_concepts', 'Design concepts', 'task', '{}', 1, datetime('now'), datetime('now')),
  ('step_dining_table_approval_signoff', 'default', 'furniture.dining_table.approval', 1, 'approval_signoff', 'Approval signoff', 'task', '{}', 1, datetime('now'), datetime('now'));
