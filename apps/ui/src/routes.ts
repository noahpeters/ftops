import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  route("", "routes/root.tsx", [
    index("routes/index.tsx"),
    route("plan-preview", "routes/plan-preview.tsx"),
    route("plan-preview/:recordUri", "routes/plan-preview-record.tsx"),
    route("events", "routes/events.tsx"),
    route("demo", "routes/demo.tsx"),
    route("templates", "routes/templates.tsx"),
    route("templates/:templateKey", "routes/templates-template.tsx"),
    route("projects", "routes/projects.tsx"),
    route("projects/:projectId", "routes/projects-project.tsx"),
    route("integrations", "routes/integrations.tsx"),
    route("ingest", "routes/ingest.tsx"),
    route("workspaces", "routes/workspaces.tsx"),
    route("*", "routes/not-found.tsx"),
  ]),
] satisfies RouteConfig;
