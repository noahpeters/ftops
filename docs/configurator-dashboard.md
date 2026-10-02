# Cabinet configurator dashboard

`/configurator` is a read-only storefront report inside FTOPS. Both the page and API require the existing system-administrator role. It is storefront-wide, not scoped to the workspace selector. Cloudflare Access and the existing API identity path remain unchanged. No public storefront administration route is introduced.

The FTOPS API connects to the H2 cabinet-rooms Worker's `/admin/dashboard` and `/admin/design` endpoints through the `CABINET_ANALYTICS_SERVICE` service binding using a dedicated read-only credential. The binding avoids same-zone public fetch restrictions between Workers; the configured HTTPS origin still supplies the request URL. Environments without the binding retain the HTTPS fallback. Browser responses never contain that credential, room edit keys, or edit hashes. There is no CRM import or outbound messaging in this feature. Customer consent and records stay in the cabinet database.

## Connect through GitHub Actions

1. Merge the companion H2 change first, applying `0008_analytics.sql` through the existing Cabinet rooms API workflow.
2. Set the same newly generated secret as `CABINET_ANALYTICS_READ_TOKEN` in H2's `cabinet-rooms-production` environment and the FTOPS repository. It must be different from H2's existing room-write service token.
3. Set the FTOPS repository variable `CABINET_ANALYTICS_URL` to the existing cabinet-rooms Worker's HTTPS origin. No browser-facing Vite variable is needed.
4. Release each repository through its normal GitHub Actions path. The H2 workflow installs the read credential; FTOPS installs its URL and matching credential. Missing configuration shows “Report unavailable,” never fake zero totals. Existing deployments can continue without optional reporting configuration.
5. Verify the actual private page as an administrator, denial for a non-administrator, a consenting tracked visit, save, price request, and an explicitly authorized share. Confirm recorded lead/contact consent and source tags. Local verification does not establish production connectivity or email delivery.

No local production deployment, database mutation, secret change, merge, or email sending is required to review the implementation.

## Definitions

- Visits: one configurator entry per consented browser-tab session, renewed after 30 minutes of inactivity. Known bot user agents are excluded at the storefront endpoint. This is not a unique-person counter or a complete bot filter.
- Designs created: new successfully saved rooms after tracking begins, including copies; autosaves and generated share snapshots do not increment this total.
- Shares: prepared share records, including requests whose email later failed. The separate email number counts recorded provider acceptances after tracking begins and does not imply inbox delivery.
- Price requests: successfully prepared estimates, counted by the existing idempotent request record.
- Leads: distinct normalized consenting sender email addresses within the selected period. The submission count includes repeated requests. Recipients and non-consenting senders are excluded.
- Visit-to-lead conversion: tracked visits beginning in the selected period with a consenting lead event by the report time. Untracked submissions are included in lead totals but excluded from conversion.
- Sources: first available campaign tag or external referring hostname in the browser-tab session. Only source, medium, and campaign tags are stored; full referring URLs, query strings, IP addresses, and fingerprints are not retained in analytics. Attribution cannot recover stripped tags or denied consent.
- Dates: rolling 7/30/90-day periods; daily buckets use UTC. The report states when tracking began. Historical visits and new-design creation dates are not fabricated.
- Gallery: rooms updated during the period, with server-generated plan geometry and share snapshots excluded. Lead previews use the saved room referenced by the lead; ordinary rooms show their current saved revision, while share snapshots are immutable. Previewing is read-only and creates no new room.

The gallery pages 12 designs at a time and the lead list pages 50 submissions at a time. Source breakdowns show the top 50 groups. The separate H2 database remains authoritative; FTOPS does not copy customer records or modify cabinet designs.

## SketchUp fabrication export

System administrators open a saved design preview and choose **Generate SketchUp export**. Construction settings default to 3/4-inch carcasses, dados/rabbets, 5/8-inch rabbeted drawer boxes, 3/8-inch drawer bottoms and separate Shaker rails/stiles/panels. Settings are editable in inches for each export. The exporter uses the exact displayed saved revision; reopen the design if it reports a revision conflict.

Download and install the `.rbz` once using SketchUp’s Extension Manager. The source and built installer live in [from-trees-sketchup](https://github.com/noahpeters/from-trees-sketchup). Open **Extensions → From Trees → Cabinet Designer**, complete the existing FTOPS email-code login, select a saved design and click **Import into SketchUp**. Save normally as `.skp`. Each stock part is a solid component with grain/width/thickness axes and machined joints. The importer validates solids before committing and reports completion back to the page. Import adds to the current model and can be undone. OpenCutList can generate parts lists; review material stock sizes and allowances before cutting.

The first pass excludes hardware, appliances, fixtures and countertops. Dovetails, slide drilling, machining tolerances and toolpaths are deferred; drawer boxes use rabbets. Unsupported corners, curved/tambour/profiled parts, angled/floating shelves and legacy face-frame layouts return explicit review issues instead of approximate stock dimensions.

The companion H2 export endpoint is `GET /admin/export`. FTOPS forwards `GET /configurator/export` through the existing private reporting binding and dedicated read token, after checking authenticated system-admin access. The browser receives only the export bundle, never credentials. Deploy the H2 companion before releasing this UI; no new secrets or migrations are required.

FTOPS serves the pinned `.rbz` through admin-only `GET /configurator/extension`, without requiring GitHub credentials in SketchUp or the browser. The bundle records its source repository, source commit and SHA-256. To update a reviewed installer, run `node scripts/import-sketchup-extension.mjs /path/to/from-trees-sketchup/dist <40-character-source-commit>`, format the generated `apps/api/src/assets/sketchupExtension.ts` and commit it. The generated download is byte-identical to the `.rbz` tracked in the extension repository.

The hosted page sends only construction JSON through SketchUp’s callback. The random per-window bridge value survives the login return URL and correlates import results; it is not an authentication credential. Normal browser visits show installation instructions, while direct import is enabled only when both this value and the actual SketchUp callback are present. Server-side administrator checks remain authoritative.
