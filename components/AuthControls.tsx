'use client';

import { FormEvent, useState } from 'react';
import { authClient } from '@/lib/auth/client';

export default function AuthControls({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle'|'sending'|'sent'|'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState('sending');
    setMessage('');
    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim().toLowerCase(),
        callbackURL: window.location.pathname || '/',
      });
      if (result.error) {
        setState('error');
        setMessage(result.error.message || 'Không gửi được liên kết đăng nhập.');
        return;
      }
      setState('sent');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Không gửi được liên kết đăng nhập.');
    }
  }

  async function logout() {
    await authClient.signOut();
    window.location.href = '/';
  }

  if (signedIn) return <button className="btn dark" onClick={logout}>Đăng xuất</button>;

  return <>
    <button className="btn dark" onClick={() => { setOpen(true); setState('idle'); setMessage(''); }}>Đăng nhập</button>
    {open && <div className="auth-modal" role="presentation">
      <button className="auth-backdrop" aria-label="Đóng" onClick={() => setOpen(false)} />
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="authTitle">
        <button className="auth-close" type="button" onClick={() => setOpen(false)} aria-label="Đóng">×</button>
        <div className="logo auth-logo">日</div>
        <div className="eyebrow">NIHONGO PLAY</div>
        <h2 id="authTitle">Đăng nhập bằng email</h2>
        {state === 'sent' ? <div className="auth-success">
          <strong>Đã gửi email.</strong>
          <span>Kiểm tra hộp thư và bấm liên kết để đăng nhập. Không cần mật khẩu.</span>
          <button className="btn" type="button" onClick={() => setState('idle')}>Dùng email khác</button>
        </div> : <>
          <p className="auth-copy">Nhập email của bạn. Nihongo Play sẽ gửi một Magic Link để đăng nhập.</p>
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="authEmail">Email</label>
            <input id="authEmail" className="auth-input" type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" required maxLength={254} placeholder="you@example.com" />
            <button className="btn dark auth-submit" disabled={state==='sending'} type="submit">{state==='sending'?'Đang gửi…':'Gửi liên kết đăng nhập'}</button>
          </form>
          <p className="auth-note">Lần đầu dùng email này, tài khoản sẽ được tạo trong Neon Auth. Phiên đăng nhập được ghi nhớ trên thiết bị.</p>
          {state==='error' && <div className="auth-error">{message}</div>}
        </>}
      </section>
    </div>}
  </>;
}
