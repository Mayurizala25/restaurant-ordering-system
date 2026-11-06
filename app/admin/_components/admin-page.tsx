import type { ReactNode } from "react";

type AdminPageHeadingProps = {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
};

export function AdminPageHeading({
  eyebrow,
  title,
  description,
  children,
}: AdminPageHeadingProps) {
  return (
    <header className="vr-admin-page-heading">
      <div className="vr-admin-page-heading-copy">
        <p className="vr-admin-page-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="vr-admin-page-description">{description}</p>
      </div>
      {children && <div className="vr-admin-page-actions">{children}</div>}
    </header>
  );
}

type AdminMetricCardProps = {
  label: string;
  value: string;
  detail: string;
  icon: "activity" | "rating" | "table";
};

const metricIcons: Record<AdminMetricCardProps["icon"], ReactNode> = {
  activity: (
    <>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </>
  ),
  rating: (
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <path d="M7 11v9m10-9v9M3 16h18" />
    </>
  ),
};

export function AdminMetricCard({
  label,
  value,
  detail,
  icon,
}: AdminMetricCardProps) {
  return (
    <article className="vr-admin-metric-card">
      <div className="vr-admin-metric-icon" aria-hidden="true">
        <svg
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        >
          {metricIcons[icon]}
        </svg>
      </div>
      <div className="vr-admin-metric-copy">
        <p>{label}</p>
        <strong>{value}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}
