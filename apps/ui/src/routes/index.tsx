import { redirect } from "react-router";

export function loader() {
  return redirect("/projects");
}

export default function Index(): null {
  return null;
}
