import Link from 'next/link';
import AuthControls from './AuthControls';
import { currentUser, isAdmin } from '@/lib/auth/helpers';

export default async function Header({ subtitle = 'Học tiếng Nhật bằng trò chơi' }: { subtitle?: string }) {
  const user = await currentUser();
  let admin = false;
  if (user) {
    try { admin = await isAdmin(user.id); } catch { admin = false; }
  }
  return <header className="top">
    <Link className="brand" href="/">
      <div className="logo">日</div>
      <div><h1>Nihongo Play</h1><p>{subtitle}</p></div>
    </Link>
    <nav className="nav">
      <Link className="btn" href="/leaderboard">BXH tuần</Link>
      {admin && <Link className="btn" href="/admin">Admin</Link>}
      <AuthControls signedIn={Boolean(user)} />
    </nav>
  </header>;
}
