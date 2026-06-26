const LABELS = {
  scheduled: 'Scheduled',
  active: 'Live',
  finished: 'Finished',
};

export default function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{LABELS[status] || status}</span>;
}
