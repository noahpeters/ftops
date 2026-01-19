import App from "@/App";
import { ServerStatus } from "@/components/ServerStatus";

export default function Index(): JSX.Element {
  return (
    <>
      <ServerStatus />
      <App />
    </>
  );
}
