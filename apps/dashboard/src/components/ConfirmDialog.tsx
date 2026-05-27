/**
 * ConfirmDialog — reusable confirmation modal for destructive actions.
 * Replaces window.confirm() prompts with a styled modal dialog.
 */

import { X, AlertTriangle } from "lucide-react";

export type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <div
      className="modalOverlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modalContent"
        style={{ maxWidth: 440 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modalHeader">
          <div className="modalDots">
            <span />
            <span />
            <span />
          </div>
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {variant === "danger" && (
              <AlertTriangle
                size={18}
                style={{ color: "var(--color-danger, #dc2626)" }}
              />
            )}
            {title}
          </h2>
          <button
            className="iconButton"
            type="button"
            onClick={onCancel}
            aria-label={cancelLabel}
          >
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              color: "var(--color-text-muted)",
              lineHeight: 1.5,
              whiteSpace: "pre-line"
            }}
          >
            {message}
          </p>
        </div>
        <div className="routeModalFooter">
          <button type="button" className="ghostButton" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="primaryButton"
            style={
              variant === "danger"
                ? { background: "var(--color-danger)", boxShadow: "none" }
                : undefined
            }
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
