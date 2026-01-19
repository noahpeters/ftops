import App from "@/App";
import { ServerStatus } from "@/components/ServerStatus";

export default function Root(): JSX.Element {
  return (
    <>
      <ServerStatus />
      <App />
    </>
  );
}
