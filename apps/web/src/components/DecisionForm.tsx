"use client";

import type { DecideLoanApplicationInput } from "@loan-review/api/router";
import { useState, type FormEvent } from "react";

export type DecisionFormValue = Omit<DecideLoanApplicationInput, "applicationId">;

interface DecisionFormProps {
  requestedAmountMinor: number;
  variant?: "review" | "confirm";
  canConfirm?: boolean;
  disabled?: boolean;
  onSubmit(value: DecisionFormValue): Promise<void> | void;
}

export function DecisionForm({
  requestedAmountMinor,
  variant = "review",
  canConfirm = true,
  disabled = false,
  onSubmit,
}: DecisionFormProps) {
  const confirmation = variant === "confirm";
  const [decision, setDecision] = useState<DecisionFormValue["decision"]>(
    confirmation && !canConfirm ? "REJECTED" : "APPROVED",
  );
  const [approvedAmount, setApprovedAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const value: DecisionFormValue =
        decision === "APPROVED" && !confirmation
          ? { decision, approvedAmountMinor: Math.round(Number(approvedAmount) * 100), reason }
          : { decision, reason };
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="decision-form" onSubmit={(event) => void handleSubmit(event)}>
      <fieldset disabled={disabled || submitting}>
        <legend>{confirmation ? "Confirmation" : "Decision"}</legend>
        {confirmation && !canConfirm ? (
          <p className="notice">You proposed this approval. Another underwriter must confirm it.</p>
        ) : (
          <label className="radio-row">
            <input
              checked={decision === "APPROVED"}
              name="decision"
              onChange={() => setDecision("APPROVED")}
              type="radio"
              value="APPROVED"
            />
            {confirmation ? "Confirm approval" : "Approve"}
          </label>
        )}
        <label className="radio-row">
          <input
            checked={decision === "REJECTED"}
            name="decision"
            onChange={() => setDecision("REJECTED")}
            type="radio"
            value="REJECTED"
          />
          Reject
        </label>

        {decision === "APPROVED" && !confirmation ? (
          <label>
            Approved amount
            <span className="input-affix">
              <span aria-hidden="true">€</span>
              <input
                inputMode="decimal"
                max={(requestedAmountMinor / 100).toFixed(2)}
                min="0.01"
                onChange={(event) => setApprovedAmount(event.target.value)}
                required
                step="0.01"
                type="number"
                value={approvedAmount}
              />
            </span>
          </label>
        ) : null}

        <label>
          Reason
          <textarea
            minLength={1}
            onChange={(event) => setReason(event.target.value)}
            required
            rows={4}
            value={reason}
          />
        </label>

        <button className="primary-button" type="submit">
          {submitting ? "Saving…" : "Record decision"}
        </button>
      </fieldset>
    </form>
  );
}
