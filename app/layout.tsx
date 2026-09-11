import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Nihongo Play — Học tiếng Nhật bằng trò chơi',description:'Học tiếng Nhật bằng trò chơi. Luyện Hiragana và Katakana, theo dõi tiến bộ và thi đua công bằng.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="vi"><body>{children}</body></html>}
