import type { MetaFunction } from "react-router";
import stylex from "~/lib/stylex";
import { LegalDocument, legalParagraph } from "../components/LegalDocument";

export const meta: MetaFunction = () => [{ title: "Privacy Policy | ftops" }];

export default function PrivacyPolicy(): JSX.Element {
  return (
    <LegalDocument title="Privacy Policy" effectiveDate="July 19, 2026">
      <p className={stylex(legalParagraph)}>
        from trees, LLC believes your business data belongs to you. ftops collects, stores, and
        processes only the information reasonably necessary to provide the service you have chosen
        to use.
      </p>
      <p className={stylex(legalParagraph)}>
        We do not sell your information, rent it, profile it for advertising, or intentionally share
        it with third parties except (1) service providers that operate the platform on our behalf
        or (2) external services that you explicitly choose to connect, such as QuickBooks Online.
        Data exchanged with those services is limited to what is necessary for the integration to
        function.
      </p>
      <p className={stylex(legalParagraph)}>
        We make reasonable efforts to protect your information from unauthorized access, alteration,
        or disclosure. While no system can guarantee absolute security, we design and operate ftops
        with the goal of minimizing data collection, limiting access, and safeguarding the
        information entrusted to us.
      </p>
      <p className={stylex(legalParagraph)}>
        We may retain information only as long as reasonably necessary to operate the service,
        comply with legal obligations, resolve disputes, or maintain business records. If this
        policy changes in a material way, the updated version will be published with a new effective
        date.
      </p>
      <p className={stylex(legalParagraph)}>
        Questions regarding this policy may be directed to{" "}
        <a href="mailto:privacy@from-trees.com">privacy@from-trees.com</a>.
      </p>
    </LegalDocument>
  );
}
