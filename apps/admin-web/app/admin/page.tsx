import { redirect } from 'next/navigation';

// /admin is not a separate dashboard. It lands on Fleet, the primary
// operator workspace for regions → clusters → hosts → machines.
export default function AdminIndexRedirect() {
  redirect('/admin/fleet');
}
