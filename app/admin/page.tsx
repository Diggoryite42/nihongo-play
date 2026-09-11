import Header from '@/components/Header';
import AuthControls from '@/components/AuthControls';
import AdminClient from '@/components/AdminClient';
import { currentUser,isAdmin } from '@/lib/auth/helpers';
import { getAdminOverview } from '@/lib/queries';
export const dynamic='force-dynamic';
export default async function Admin(){const user=await currentUser();if(!user)return <div className="wrap"><Header subtitle="Admin"/><section className="card admin-gate"><h2>Cần đăng nhập</h2><p>Trang này chỉ dành cho admin.</p><AuthControls signedIn={false}/></section></div>;if(!(await isAdmin(user.id)))return <div className="wrap"><Header subtitle="Admin"/><section className="card admin-gate"><h2>403</h2><p>Tài khoản này không có quyền admin.</p></section></div>;const data=await getAdminOverview();return <div className="wrap"><Header subtitle="Admin • người dùng • học tập • abuse"/><AdminClient data={data}/></div>}
