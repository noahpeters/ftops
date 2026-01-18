-- Migration number: 0007 	 2026-01-17T03:29:29.143Z
-- seed commercial registries

INSERT OR IGNORE INTO line_item_categories (key, label, description, is_active, created_at, updated_at) VALUES
  ('furniture', 'Furniture', 'Standalone furniture items', 1, datetime('now'), datetime('now')),
  ('cabinetry', 'Cabinetry', 'Built-ins and cabinet runs', 1, datetime('now'), datetime('now')),
  ('design', 'Design', 'Design services and deliverables', 1, datetime('now'), datetime('now')),
  ('delivery', 'Delivery', 'Delivery / freight charges', 1, datetime('now'), datetime('now')),
  ('install', 'Install', 'Installation labor', 1, datetime('now'), datetime('now'));

INSERT OR IGNORE INTO deliverable_kinds (key, category_key, label, description, is_active, created_at, updated_at) VALUES
  ('dining_table', 'furniture', 'Dining table', 'Custom dining tables', 1, datetime('now'), datetime('now')),
  ('coffee_table', 'furniture', 'Coffee table', 'Custom coffee tables', 1, datetime('now'), datetime('now')),
  ('nightstand', 'furniture', 'Nightstand', 'Custom nightstands', 1, datetime('now'), datetime('now')),
  ('bed', 'furniture', 'Bed', 'Beds / headboards', 1, datetime('now'), datetime('now')),
  ('cabinet_run', 'cabinetry', 'Cabinet run', 'Cabinet run / built-in section', 1, datetime('now'), datetime('now')),
  ('wall_unit', 'cabinetry', 'Wall unit', 'Feature wall / entertainment build', 1, datetime('now'), datetime('now')),
  ('design_services', 'design', 'Design services', 'Renderings / AR / revisions', 1, datetime('now'), datetime('now')),
  ('delivery_service', 'delivery', 'Delivery', 'Delivery / freight', 1, datetime('now'), datetime('now')),
  ('install_service', 'install', 'Installation', 'Installation labor', 1, datetime('now'), datetime('now'));
