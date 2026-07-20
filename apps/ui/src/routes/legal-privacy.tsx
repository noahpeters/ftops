import type { MetaFunction } from "react-router";
import stylex from "~/lib/stylex";
import { LegalDocument, legalParagraph } from "../components/LegalDocument";

export const meta: MetaFunction = () => [{ title: "Privacy Policy | ftops" }];

export default function PrivacyPolicy(): JSX.Element {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate="July 19, 2026"
      effectiveDateLabel="Effective"
    >
      <p className={stylex(legalParagraph)}>
        from trees, LLC believes your business data belongs to you. ftops collects, stores, and
        processes only the information reasonably necessary to provide the features you choose to
        use.
      </p>
      <p className={stylex(legalParagraph)}>
        We do not sell your information, rent it, profile it for advertising, or intentionally
        disclose it to third parties. Your information is shared only (1) with the infrastructure
        providers required to securely operate ftops on your behalf or (2) with external services
        that you explicitly choose to connect, such as QuickBooks Online. We share only the
        information necessary for those services to perform their intended function.
      </p>
      <p className={stylex(legalParagraph)}>
        We design ftops to collect as little information as practical, limit internal access to that
        information, and protect it from unauthorized access, alteration, or disclosure. While no
        system can guarantee absolute security, safeguarding your information is a core design
        principle of the application.
      </p>
      <p className={stylex(legalParagraph)}>
        We retain information only as long as reasonably necessary to operate the service, comply
        with legal obligations, resolve disputes, or maintain business records. If this policy
        changes in a material way, the updated version will be published with a new effective date.
      </p>
      <p className={stylex(legalParagraph)}>
        Questions regarding this policy may be directed to{" "}
        <strong>
          <a href="mailto:privacy@from-trees.com">privacy@from-trees.com</a>
        </strong>
        .
      </p>
    </LegalDocument>
  );
}
