import { redirect } from 'next/navigation';

/**
 * `/admin` itself has nothing to show — three sibling screens do. Approvals is the
 * default landing point because it is the one queue that grows on its own (a new signup)
 * without an admin having gone looking for it; Faculty and Logs are both look-something-up
 * tools an admin visits with intent, not glances at "just in case".
 */
export default function AdminIndexPage() {
  redirect('/admin/approvals');
}
