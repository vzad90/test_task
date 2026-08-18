"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { DecisionForm, type DecisionFormValue } from "@/components/DecisionForm";
import { formatMoney } from "@/lib/money";
import { trpc } from "@/lib/trpc";
import { Providers, useSession } from "../../providers";

function decisionErrorMessage(code: string | undefined, message: string) {
  if (code === "CONFLICT") {
    return "Another underwriter already processed this application.";
  }
  if (code === "FORBIDDEN") {
    return message || "You are not allowed to record this decision.";
  }
  return message;
}

function ApplicationReview() {
  const params = useParams<{ id: string }>();
  const applicationId = params.id;
  const { user } = useSession();

  const utils = trpc.useUtils();
  const application = trpc.loanApplications.getForReview.useQuery({ applicationId });
  const decide = trpc.loanApplications.decide.useMutation();

  if (application.isPending) {
    return <main className="shell">Loading application…</main>;
  }

  if (application.isError) {
    return (
      <main className="shell" role="alert">
        Could not load this application: {application.error.message}
      </main>
    );
  }

  const item = application.data;
  const awaitingReview = item.status === "PENDING_REVIEW";
  const awaitingConfirmation = item.status === "PENDING_CONFIRMATION";
  const canConfirm = Boolean(item.proposedByUserId && item.proposedByUserId !== user.id);

  async function submit(value: DecisionFormValue) {
    const amount =
      value.approvedAmountMinor === undefined
        ? {}
        : { approvedAmountMinor: value.approvedAmountMinor };
    await decide.mutateAsync({
      applicationId,
      decision: value.decision,
      reason: value.reason,
      ...amount,
    });
    await utils.loanApplications.getForReview.invalidate({ applicationId });
    await utils.loanApplications.list.invalidate();
  }

  return (
    <main className="shell">
      <Link className="back-link" href="/">
        Applications
      </Link>
      <div className="eyebrow">Application {item.id}</div>
      <div className="title-row">
        <h1>{item.customer.fullName}</h1>
        <span className={`status status-${item.status.toLowerCase()}`}>{item.status}</span>
      </div>

      <section className="summary-card" aria-labelledby="application-summary">
        <h2 id="application-summary">Application summary</h2>
        <dl>
          <div>
            <dt>Requested</dt>
            <dd>{formatMoney(item.requestedAmountMinor)}</dd>
          </div>
          {item.approvedAmountMinor !== null ? (
            <div>
              <dt>{awaitingConfirmation ? "Proposed approval" : "Approved"}</dt>
              <dd>{formatMoney(item.approvedAmountMinor)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Email</dt>
            <dd>{item.customer.email}</dd>
          </div>
        </dl>
      </section>

      {awaitingReview || awaitingConfirmation ? (
        <section aria-labelledby="record-decision">
          <h2 id="record-decision">
            {awaitingConfirmation ? "Confirm or reject" : "Record a decision"}
          </h2>
          <DecisionForm
            canConfirm={canConfirm}
            disabled={decide.isPending}
            onSubmit={submit}
            requestedAmountMinor={item.requestedAmountMinor}
            variant={awaitingConfirmation ? "confirm" : "review"}
          />
          {decide.isError ? (
            <p className="error" role="alert">
              {decisionErrorMessage(decide.error.data?.code, decide.error.message)}
            </p>
          ) : null}
        </section>
      ) : (
        <p className="notice">This application has already been processed.</p>
      )}
    </main>
  );
}

export default function ApplicationReviewPage() {
  return (
    <Providers>
      <ApplicationReview />
    </Providers>
  );
}
