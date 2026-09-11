import { db } from './db';

export async function getLeaderboard(limit=100){
  const sql=db();
  return sql`
    SELECT p.display_name,l.ranking_score,l.progress_score,l.study_score,l.meaningful_reviews,l.unique_kana
    FROM leaderboard_scores l JOIN profiles p ON p.user_id=l.user_id
    WHERE l.period_start=date_trunc('week',now() AT TIME ZONE 'UTC')::date
    ORDER BY l.ranking_score DESC,l.progress_score DESC
    LIMIT ${limit}
  `;
}

export async function getAdminOverview(){
  const sql=db();
  const [metrics,users,flags]=await Promise.all([
    sql`SELECT (SELECT count(*) FROM profiles)::int users,
               (SELECT count(*) FROM profiles WHERE last_active_at>now()-interval '7 days')::int active,
               (SELECT count(*) FROM answer_events)::int answers,
               (SELECT count(*) FILTER(WHERE is_correct)::numeric/nullif(count(*),0) FROM answer_events) accuracy`,
    sql`SELECT p.user_id,p.display_name,p.last_active_at,
               coalesce(sum(k.total_attempts),0)::int attempts,
               coalesce(sum(k.correct_attempts),0)::int correct,
               count(*) FILTER(WHERE k.mastery_score>=85)::int mastered,
               coalesce(l.ranking_score,0) ranking_score,coalesce(l.progress_score,0) progress_score,
               coalesce(l.study_score,0) study_score,
               (SELECT count(*) FROM abuse_flags a WHERE a.user_id=p.user_id AND a.status='open')::int flag_count
        FROM profiles p LEFT JOIN kana_progress k ON k.user_id=p.user_id
        LEFT JOIN leaderboard_scores l ON l.user_id=p.user_id AND l.period_start=date_trunc('week',now() AT TIME ZONE 'UTC')::date
        GROUP BY p.user_id,l.ranking_score,l.progress_score,l.study_score ORDER BY p.last_active_at DESC LIMIT 500`,
    sql`SELECT user_id,reason,severity,detected_at,status FROM abuse_flags ORDER BY detected_at DESC LIMIT 100`
  ]);
  return {metrics:metrics[0]||{},users,flags};
}
