import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic='force-dynamic';
export async function GET(){
  try{
    const sql=db();
    const rows=await sql`SELECT count(*)::int AS kana_count FROM kana_catalog`;
    return NextResponse.json({ok:true,database:true,kanaCount:rows[0]?.kana_count??0,authConfigured:Boolean(process.env.DATABASE_URL && process.env.NEON_AUTH_COOKIE_SECRET)});
  }catch(error){
    console.error('health_error',error);
    return NextResponse.json({ok:false,database:false,authConfigured:Boolean(process.env.DATABASE_URL && process.env.NEON_AUTH_COOKIE_SECRET)},{status:503});
  }
}
