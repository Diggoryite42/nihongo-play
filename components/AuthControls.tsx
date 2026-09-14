'use client';

import { FormEvent, useEffect, useState } from 'react';
import { authClient } from '@/lib/auth/client';

type ProfileState = 'idle'|'saving'|'saved'|'error';

export default function AuthControls({ signedIn, displayName = null }: { signedIn: boolean; displayName?: string | null }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle'|'sending'|'sent'|'error'>('idle');
  const [message, setMessage] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(displayName || '');
  const [profileDraft, setProfileDraft] = useState(displayName || '');
  const [profileState, setProfileState] = useState<ProfileState>('idle');
  const [profileMessage, setProfileMessage] = useState('');

  useEffect(() => {
    if (displayName) {
      setProfileName(displayName);
      if (!profileOpen) setProfileDraft(displayName);
    }
  }, [displayName, profileOpen]);

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

  async function saveProfileName(e: FormEvent) {
    e.preventDefault();
    setProfileState('saving');
    setProfileMessage('');
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: {'content-type':'application/json'},
        body: JSON.stringify({displayName: profileDraft}),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProfileState('error');
        setProfileMessage(payload.error === 'name_taken'
          ? 'Tên này đã có người dùng. Hãy chọn tên khác.'
          : payload.error === 'invalid_name'
            ? 'Tên phải dài 2–24 ký tự và không chứa ký tự điều khiển.'
            : 'Không thể lưu tên lúc này.');
        return;
      }
      const nextName = String(payload.displayName || profileDraft);
      setProfileName(nextName);
      setProfileDraft(nextName);
      setProfileState('saved');
      setProfileMessage('Đã lưu. Tên mới sẽ dùng trên bảng xếp hạng.');
    } catch {
      setProfileState('error');
      setProfileMessage('Không thể kết nối để lưu tên.');
    }
  }

  async function logout() {
    await authClient.signOut();
    window.location.href = '/';
  }

  if (signedIn) return <>
    <button className="btn profile-name-btn" onClick={() => {
      setProfileDraft(profileName);
      setProfileState('idle');
      setProfileMessage('');
      setProfileOpen(true);
    }}>{profileName ? `Tên: ${profileName}` : 'Đặt tên'}</button>
    <button className="btn dark" onClick={logout}>Đăng xuất</button>
    {profileOpen && <div className="auth-modal" role="presentation">
      <button className="auth-backdrop" aria-label="Đóng" onClick={() => setProfileOpen(false)} />
      <section className="auth-panel" role="dialog" aria-modal="true" aria-labelledby="profileTitle">
        <button className="auth-close" type="button" onClick={() => setProfileOpen(false)} aria-label="Đóng">×</button>
        <div className="logo auth-logo">日</div>
        <div className="eyebrow">HỒ SƠ NGƯỜI HỌC</div>
        <h2 id="profileTitle">Tên hiển thị</h2>
        <p className="auth-copy">Tên này được hiển thị công khai trên bảng xếp hạng tuần. Mỗi người dùng phải có một tên riêng.</p>
        <form className="auth-form" onSubmit={saveProfileName}>
          <label htmlFor="profileDisplayName">Tên của bạn</label>
          <input
            id="profileDisplayName"
            className="auth-input"
            type="text"
            value={profileDraft}
            onChange={e=>{setProfileDraft(e.target.value);setProfileState('idle');setProfileMessage('')}}
            autoComplete="nickname"
            required
            maxLength={48}
            placeholder="Ví dụ: Diggory"
          />
          <button className="btn dark auth-submit" disabled={profileState==='saving'} type="submit">
            {profileState==='saving'?'Đang lưu…':'Lưu tên'}
          </button>
        </form>
        <p className="auth-note">2–24 ký tự. Có thể dùng tiếng Việt, tiếng Nhật, chữ số và khoảng trắng. Không phân biệt hoa/thường khi kiểm tra trùng tên.</p>
        {profileMessage && <div className={profileState==='saved'?'auth-success':'auth-error'}>{profileMessage}</div>}
      </section>
    </div>}
  </>;

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
