import Header from '@/components/Header';
import { getLeaderboard } from '@/lib/queries';
export const dynamic='force-dynamic';
export default async function Leaderboard(){
  const rows=await getLeaderboard();
  return <div className="wrap"><Header subtitle="BXH tuần • học nhiều và tiến bộ thật"/><section className="card section"><div className="page-title"><div className="eyebrow">Tuần hiện tại</div><h2>Xếp hạng Nihongo Play</h2><p>Điểm cân bằng giữa tiến bộ thực sự và khối lượng học có ý nghĩa.</p></div><div className="table-wrap"><table className="table"><thead><tr><th>#</th><th>Người học</th><th>Điểm</th><th>Tiến bộ</th><th>Mức học</th><th>Lượt ôn có giá trị</th><th>Kana</th></tr></thead><tbody>{rows.length?rows.map((r:any,i:number)=><tr key={`${r.display_name}-${i}`}><td>{i+1}</td><td><strong>{r.display_name}</strong></td><td><strong>{Math.round(Number(r.ranking_score))}</strong></td><td>{Number(r.progress_score).toFixed(1)}</td><td>{Number(r.study_score).toFixed(1)}</td><td>{Number(r.meaningful_reviews).toFixed(1)}</td><td>{r.unique_kana}</td></tr>):<tr><td colSpan={7}>Chưa có dữ liệu trong tuần này.</td></tr>}</tbody></table></div></section></div>;
}
