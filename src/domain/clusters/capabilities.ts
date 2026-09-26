/** Collapsed member nodes remain rendered as invisible runtime hosts. */
export const COLLAPSED_CLUSTER_MEMBERS_STAY_MOUNTED = true;

/** Collapse must never be enabled without preserving component-owned runtimes. */
export const CLUSTER_COLLAPSE_ENABLED = COLLAPSED_CLUSTER_MEMBERS_STAY_MOUNTED;
