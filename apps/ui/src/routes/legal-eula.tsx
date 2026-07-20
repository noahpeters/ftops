import type { MetaFunction } from "react-router";
import stylex from "~/lib/stylex";
import { LegalDocument, legalParagraph } from "../components/LegalDocument";

export const meta: MetaFunction = () => [{ title: "End User License Agreement | ftops" }];

export default function EndUserLicenseAgreement(): JSX.Element {
  return (
    <LegalDocument title="End User License Agreement" effectiveDate="July 19, 2026">
      <p className={stylex(legalParagraph)}>
        ftops is software provided by from trees, LLC for authorized business use. By using ftops,
        you agree to use it lawfully and not to interfere with its operation, attempt to gain
        unauthorized access, or use it in a way that could harm the service or other users.
      </p>
      <p className={stylex(legalParagraph)}>
        The software is provided “as is.” While we strive to build reliable software, we cannot
        guarantee uninterrupted service, error-free operation, or fitness for every purpose. You are
        responsible for your own business decisions and for maintaining appropriate backups of your
        data.
      </p>
      <p className={stylex(legalParagraph)}>
        To the fullest extent permitted by law, from trees, LLC is not liable for indirect,
        incidental, special, or consequential damages arising from the use of ftops. We may suspend
        or terminate access to protect the security, integrity, or operation of the service.
      </p>
    </LegalDocument>
  );
}
